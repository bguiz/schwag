'use strict';

const validator = require('./validator.js');

const schemas = new Map();

module.exports = {
	addSchema,
	validator,
	express: swaggerValidateExpress,
};

/*
 * Add a Swagger JSON schema to the validator
 */
function addSchema (schema) {
	const schemaName = schema.info.title;
	if (schemas.get(schemaName)) {
		throw `Schema with same name has previously been added: ${schemaName}`;
	}
	validator.addSchema(schema, schemaName);
	schemas.set(schemaName, schema);
}

/*
 * Obtains request and response express middleware
 */
function swaggerValidateExpress (options) {
	return swaggerValidateRouteClosure(options).express;
}

/*
 * Replaces special characters in JSON schema pointers
 * See: https://tools.ietf.org/html/rfc6901#section-3
 */
function jsonPointerEscape (str) {
	return str.replace(/\~/g, '~0').replace(/\//g, '~1');
}

/*
 * Replaces JSON schema style path parameters (`/{param}`)
 * with express style path parameters (`/:param`)
 */
function expressPathEscape (str) {
	return str.replace(/\/\{([^\}]+)\}/g, '/:$1');
}

/*
 * Closure over per-route swagger validation functions
 */
function swaggerValidateRouteClosure ({
	schemaName,
	routePath,
	routeVerb,
}) {
	const swaggerSchema = schemas.get(schemaName);
	const routeDef = swaggerSchema.paths[routePath][routeVerb];
	const routeParams = routeDef.parameters || [];
	const routeSchemaPointer =
		`${schemaName}#/paths/${jsonPointerEscape(routePath)}/${routeVerb}`;

	return {
		express: {
			path: expressPathEscape(routePath),
			request: swaggerRequestExpress,
			response: swaggerResponseExpress,
		},
	};

	/*
	 * Parses express request to create an `input` object
	 */
	function swaggerRequestExpress (req, res, next) {
		const input = {
			params: new Map(),
			headers: new Map(),
			body: undefined,
			errors: [],
		};

		//TODO swap Object.keys() for Object.entries() when that lands in NodeJs
		// Parse all query params -> input.params
		Object.keys(req.query).forEach((key) => {
			const value = req.query[key];
			input.params.set(key, value);
		});
		// Parse all path params -> input.params
		// Note that path params will overwrite query params
		Object.keys(req.params).forEach((key) => {
			const value = req.params[key];
			input.params.set(key, value);
		});
		// Parse all header params (keys lowercased) -> input.headers
		Object.keys(req.headers).forEach((key) => {
			const value = req.headers[key];
			input.headers.set(key, value);
		});
		// No parse necessary:  body -> input.body
		input.body = req.body;

		swaggerRequestValidate(
			input,
			() => {
				//NOTE no special handling for `err` case at the moment
				res.locals.input = input;
				next();
			}
		);
	}

	/*
	 * Parses `output` object to create an express response
	 */
	function swaggerResponseExpress (req, res) {
		const output = res.locals.output;

		swaggerResponseValidate(
			res.locals.input,
			output,
			() => {
				//NOTE no special handling for `err` case at the moment
				res
					.status(output.status)
					.set(output.headers)
					.json(output.body);
			}
		);
	}

	/*
	 * Verifies if an `input` object is valid according to the specified schema.
	 */
	function swaggerRequestValidate (input, errback) {
		routeParams.forEach((routeParam, routeParamIdx) => {
			let isValid;
			let value;
			let actualValue;
			let matchedIn = true;
			let validationRefPath;
			switch (routeParam.in) {
			case 'query':
			case 'path':
				value = input.params.get(routeParam.name);
				break;
			case 'header':
				value = input.headers.get(routeParam.name);
				break;
			case 'body':
				// body may be defined using a schema
				value = input.body;
				break;
			default:
				matchedIn = false;
			}
			if (!matchedIn) {
				input.errors.push(`Unrecognised "in" for parameter: ${routeParam.in}`);
				return;
			}
			validationRefPath = `${routeSchemaPointer}/parameters/${routeParamIdx}`;
			if (typeof routeParam.default !== 'undefined' &&
				typeof value === 'undefined') {
				actualValue = routeParam.default;
				// We assume that the default value specified in the schema does not require validation,
				// as that should have been done when writing the schema itself
			} else if (routeParam.required === false &&
				typeof value === 'undefined') {
				// Skip validation when parameter is unspecified, and it is not required
			} else {
				if (typeof value === routeParam.type) {
					actualValue = value;
				} else if (typeof routeParam.schema === 'object') {
					validationRefPath = `${validationRefPath}/schema`;
					actualValue = value;
				} else {
					switch (routeParam.type) {
					case 'number':
						actualValue = isNaN(+value)
							? value // Pass through original value, will fail validation
							: (+value);
						break;
					case 'boolean':
						actualValue =
							(value === 'true' || value === 'false')
							? (value === 'true')
							: value; // Pass through original value, will fail validation
						break;
					case 'string':
						// To take into account that overly enthusiastic libs such as express
						// convert strings to numbers whenever they can be
						actualValue =
							(typeof value !== 'undefined')
							? `${value}`
							: value;
						break;
					//NOTE array and object parameters are not handled at all presently
					default:
						// Pass through
					}
				}

				// Validate input against JSON schema using ajv
				isValid = validator.validate({
					'$ref': validationRefPath,
				}, actualValue);
				if (!isValid) {
					input.errors.push(validator.errors);
				}
			}
			if (value !== actualValue) {
				// Update the input appropriately
				switch (routeParam.in) {
				case 'query':
				case 'path':
					input.params.set(routeParam.name, actualValue);
					break;
				case 'header':
					input.headers.set(routeParam.name, actualValue);
					break;
				default:
					// this does not apply to body
					// query, path, header, parameters are always received in the request as strings
					// and we use the schema validation to update them to the appropriate types
				}
			}
		});

		errback((input.errors.length > 0 ? input.errors : undefined));
	}

	/*
	 * Verifies if an `output` object is valid according to the specified schema.
	 * Note that this validation only occurs during development,
	 * and _not_ in production, for performance reasons.
	 */
	function swaggerResponseValidate (input, output, errback) {
		if (process.env.NODE_ENV !== 'production') {
			// Validate output against JSON schema using ajv
			const isValid = validator.validate({
				'$ref': `${routeSchemaPointer}/responses/${output.status}`,
			}, output.body);
			if (!isValid) {
				input.errors.push(validator.errors);
				output.status = 500;
				output.body = {
					code: 500999,
					message: 'Response validation failed',
					errors: input.errors,
					original: output.body,
				};
			}
		}

		errback((input.errors.length > 0 ? input.errors : undefined));
	}

}
