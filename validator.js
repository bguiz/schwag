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
// Custom validation keywords so that we can use
// buffers and stream in validation schema
validator.addKeyword('buffer', {
	compile: () => {
		return (data) => {
			return Buffer.isBuffer(data);
		};
	},
});
validator.addKeyword('readableStream', {
	compile: () => {
		return (data) => {
			return isReadableStream(data);
		};
	},
});
validator.addKeyword('writeableStream', {
	compile: () => {
		return (data) => {
			return isWriteableStream(data);
		};
	},
});
function isStream (obj) {
	return obj &&
		(typeof obj === 'object') &&
		(typeof obj.pipe === 'function');
}
function isReadableStream (obj) {
	return isStream(obj) &&
		(obj.readable !== false) &&
		(typeof obj._read === 'function') &&
		(typeof obj._readableState === 'object');
}
function isWriteableStream (obj) {
	return isStream(obj) &&
		(obj.writable !== false) &&
		(typeof obj._write === 'function') &&
		(typeof obj._writableState === 'object');
}
module.exports = validator;
