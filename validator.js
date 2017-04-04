'use strict';

const ajv = require('ajv');

const validator = new ajv();

validator.addFormat('integer', (value) => {
	// All numbers are floating point in JS, so here we're really just testing that it is a whole number
	return !isNaN(value) && (Math.floor(value) === value);
});
validator.addFormat('double', (value) => {
	// The base validation already would have checked that `type` is `number`, and they're floating point
	// This simply flags ajv to skip the warning that would otherwise occur
	return !isNaN(value);
});

module.exports = validator;
