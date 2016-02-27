'use strict';

var fs = require('fs');
var async = require('async');

// This is EXTREMELY slow, but does not use as much memory as fs.writeFile(fn, JSON.stringify()...)
// Maybe adapt this: http://docs.sencha.com/touch/1.1.1/source/JSON.html

function stringifyToStream(stream, object, replacer, space, callback) {
	var size = 0;

	var write = function(str, cb) {
		//fs.write(fd, str, cb);
		size += str.length;
		stream.write(str, 'utf8', cb);
	};

	var stringifyObj = function(obj, cb) {
		var count = 0;
		write('{', function() {
			async.eachSeries(Object.keys(obj), function(key, subcb) {
				count++;
				write((count>1?',':'') + '"' + key + '":', function() {
					stringify(obj[key], subcb);
				});
			},
			function() {
				write('}', cb);
			});
		});
	};

	var stringifyArray = function(arr, cb) {
		var count = 0;
		write('[', function() {
			async.eachSeries(arr, function(x, subcb) {
				count++;
				if (count > 1)
					write(',', function() { stringify(x, subcb); });
				else
					stringify(x, subcb);
			},
			function() {
				write(']', cb);
			});
		});
	};

	var stringify = function(x, cb) {
		if (x === null) {
			write('null', cb);
		}
		else if (x === undefined) {
			write('undefined', cb);
		}
		else if (typeof(x) === 'boolean') {
			write((x?'true':'false'), cb);
		}
		else if (typeof(x) === 'string') {
			write('"' + x.replace(/"/gi, '\\"').replace(/\n/gi, '\\n') + '"', cb);
		}
		else if (typeof(x) === 'number') {
			write(x.toString(), cb);
		}
		else if (typeof(x) === 'object') {
			if (Array.isArray(x))
				stringifyArray(x, cb);
			else
				stringifyObj(x, cb);
		}
		else {
			console.log("unhandled type: " + typeof(x));
		}
	};

	stringify(object, function() {
		nextTick(function() {
			callback(null, size);
		})
	});
}

function stringifyToFile(filename, object, replacer, space, callback) {
	var stream = fs.createWriteStream(filename, { flags: 'w' });
	stringifyToStream(stream, function(err, size) {
		stream.end();
		nextTick(function() {
			callback(err, size);
		});
	})
}

stringifyToFile.stream = stringifyToStream;

module.exports = stringifyToFile;

