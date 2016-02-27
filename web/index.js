'use strict';

var exports = {};

(function(exports) {
	// Requires
	var fs = require('fs');
	var path = require('path');
	var rimraf = require('rimraf');

	var moment = require("moment");
	var printUtil = require("xutil").print;
	var dustUtil = require("xutil").dust;
	var runUtil = require("xutil").run;
	var base = require('xbase');
	var tiptoe = require('tiptoe');
	var async = require('async');
	var stringifyToFile = require('stringifytofile');
	var zlib = require('zlib');
	var gzip = zlib.createGzip('level=9');

	// MTGJson requires
	var C = require('C');
	var shared = require('shared');

	// Module internaldata
	var JSONP_PREFIX = "mtgjsoncallback(";
	var JSONP_SUFFIX = ");";
	var allData = null;


	var DEBUG = false;

	(function() {
		var joined = process.argv.join(' ');

		if (joined.match(/--debug/))
			DEBUG = true;
	})();

	// Deletes and re-creates the JSON folder according to exports.outputPath
	var setupJSONDir = function(callback) {
		tiptoe(
			function () {
				rimraf(path.join(exports.outputPath, "json"), this);
			},
			function () {
				fs.mkdir(path.join(exports.outputPath, "json"), this);
			},
			function (err) {
				if (callback)
					callback(err);
			}
		);
	};

	// Loads the entire database of data from the disk
	var loadData = function(callback) {
		if (allData != null)
			return(allData);

		allData = {};
		async.eachSeries(
			C.SETS, 
			function(SET, cb) {
				fs.readFile(path.join(exports.jsonPath, SET.code + ".json"), { encoding : "utf8" }, function(err, data) {
					allData[SET.code] = JSON.parse(data);
					cb(err);
				});
			},
			function(err) {
				callback(err, allData);
			}
		);
	};

	// Module exposed variables
	exports.outputPath = shared.config['public'];
	exports.jsonPath = path.join(__dirname, '..', 'json');

	/**
	 * Properly enclose jsonp file data
	 */
	var jsonp = function(setCode, data) {
		return(JSONP_PREFIX + data + ', "' + setCode + '"' + JSONP_SUFFIX);
	};

	// Saves the given set appropriately
	var saveSet = function(setCode, regularSet, fullSet, callback) {
		var outPath = path.join(exports.outputPath, 'json', setCode);
		var size = 0, fullSize = 0;

		var compressJSON = function(fn, cb) {
			var inp = fs.createReadStream(fn);
			var out = fs.createWriteStream(fn + '.gz');

			var gzip = zlib.createGzip('level=9');

			inp.pipe(gzip).pipe(out);

			out.on('close', cb);
		};

		var jsonFN = outPath + '.json';
		var jsonFullFN = outPath + '-x.json';
		tiptoe(
			function() {
				//var out = JSON.stringify(regularSet);
				//size = printUtil.toSize(out.length, 0);
				stringifyToFile(jsonFN, regularSet, null, null, this);
				//saveFile(outPath + '.json', out, this);
			},
			function(_size) {
				size = _size;
				// Compress
				compressJSON(jsonFN, this);
			},
			function() {
				var self = this;
				
				// jsonp
				var stream = fs.createWriteStream(jsonFN + 'p', { flags: 'w' });
				stream.write(JSONP_PREFIX);

				// This is not really smart. We should use the already-generated JSON file.
				stringifyToFile.stream(stream, regularSet, null, null, function() {
					stream.write(', "' + setCode + '"' + JSONP_SUFFIX);
					stream.end();
					self();
				});
			},
			function() {
				// Compress JSONP
				compressJSON(jsonFN + 'p', this);
			},
			/** FULL SET **/
			function() {
				if (!fullSet) {
					this();
					return;
				}

				stringifyToFile(jsonFullFN, fullSet, null, null, this);
			},
			function(_size) {
				fullSize = _size;
				// Compress
				compressJSON(jsonFullFN, this);
			},
			function() {
				var self = this;
				
				// jsonp
				var stream = fs.createWriteStream(jsonFullFN + 'p', { flags: 'w' });
				stream.write(JSONP_PREFIX);

				// This is not really smart. We should use the already-generated JSON file.
				stringifyToFile.stream(stream, fullSet, null, null, function() {
					stream.write(', "' + setCode + '"' + JSONP_SUFFIX);
					stream.end();
					self();
				});
			},
			function() {
				// Compress JSONP
				compressJSON(jsonFullFN + 'p', this);
			},
			function(err) {
				if (callback)
					callback(err, size, fullSize);
			}
		);
	};

	// Strips "extra" info from given card
	var stripCardInfo = function(card) {
		C.EXTRA_FIELDS.forEach(function(EXTRA_FIELD) {
			delete card[EXTRA_FIELD];
		});
	};

	var saveDust = function(dustData, callback) {
		base.info("Rendering dust files...");

		var renderDust = function(input, output, cb) {
			var dustDoc = null;
			tiptoe (
				function() {
					// Render dust
					dustUtil.render(__dirname, input, dustData, { keepWhitespace : true }, this);
				},
				function(doc) {
					// Save doc
					base.info("Writing %s...", output);
					dustDoc = doc;
					fs.writeFile(path.join(exports.outputPath, output), doc, { encoding: 'utf8' }, this);
				},
				function () {
					// Compress GZip
					zlib.gzip(dustDoc, this);
				},
				function (buffer) {
					// Save compressed
					fs.writeFile(path.join(exports.outputPath, output + '.gz'), buffer, { encoding: 'utf8' }, this);
				},
				function(err) {
					// All done.
					if (err)
						base.error("ERROR Rendering DUST for file %s", output);
					return(setImmediate(function() { if (cb) cb(err); }));
				}
			);
		};

		tiptoe(
			function() {
				renderDust('index', 'index.html', this.parallel());
				renderDust('atom', 'atom.xml', this.parallel());
				renderDust('sitemap', 'sitemap.xml', this.parallel());

				renderDust('documentation', 'documentation.html', this.parallel());
				renderDust('changelog', 'changelog.html', this.parallel());
				renderDust('sets', 'sets.html', this.parallel());
			},
			callback
		);
	};

	/**
	 * Calls the given function on each file on the given path (recursively)
	 * Function must be in the format `function(filename, callback)`
	 */
	var traverseFileSystem = function (currentPath, func, callback) {
		// TODO: Remove this Sync call.
		var files = fs.readdirSync(currentPath);
		var i = 0, l = files.length;

		var next = function(err) {
			// Throw error?
			if (err)
				return(setImmediate(function() { if (callback) callback(err); }));

			// Are we done?
			if (i >= l)
				return(setImmediate(function() { if (callback) callback(); }));

			var currentFile = currentPath + '/' + files[i++];
			//base.info("Processing %s - %d/%d", currentFile, i, l);
			// TODO: Remove this Sync call.
			var stats = fs.statSync(currentFile);
			if (stats.isFile()) {
				setImmediate(function() { func(currentFile, next) });
			}
			else if (stats.isDirectory()) {
				// Call ourself with the child dir. It will call our 'next' function when done, resuming processing.
				traverseFileSystem(currentFile, func, next);
			}
		};

		next();
	};

	var traverseFileSystemSync = function (currentPath, func) {
		var files = fs.readdirSync(currentPath);
		var i, l = files.length;
		for (i = 0; i < l; i++) {
			//log.info("Parsing %s", files[i]);
			var currentFile = currentPath + '/' + files[i];
			var stats = fs.statSync(currentFile);
			if (stats.isFile())
				func(currentFile);
			else if (stats.isDirectory())
				traverseFileSystem(currentFile, func);
		}
	};

	// Methods
	exports.generate = function(callback) {
		var dustData = {
			title : "Magic the Gathering card data in JSON format",
			sets  : [],
			setCodesNotOnGatherer : C.SETS_NOT_ON_GATHERER.join(", "),
			analytics : "<scr" + "ipt>(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)})(window,document,'script','//www.google-analytics.com/analytics.js','ga');ga('create', 'UA-66983210-2', 'auto');ga('send', 'pageview');</scr" + "ipt>"
		};

		var changeLog = null;

		tiptoe(
			function () {
				// Remove existing data
				base.info("Clearing JSON directory...");
				setupJSONDir(this);
			},
			function () {
				base.info("Loading JSON...");
				loadData(this);
			},
			function (sets) {
				base.info("Saving JSON files...");

				var self = this;

				var allSets = {};
				var allSetsWithExtras = {};

				tiptoe(
					function() {
						// Populate allSets and allSetsWithExtras
						async.eachSeries(Object.keys(sets), function(set, callback) {
							var fullSet = sets[set];

							// Preliminar dust set data
							var dustSetData = {
								code : fullSet.code,
								lcCode : fullSet.code.toLowerCase(),
								name : fullSet.name,
								releaseDate : fullSet.releaseDate,
								size : 0,
								sizeX : 0
							};

							if (fullSet.isMCISet)
								dustSetData.isMCISet = true;
							if (fullSet.code === 'CON')
								dustSetData.isCON = true;

							// Delete internal stuff
							delete fullSet.isMCISet;
							delete fullSet.magicRaritiesCode;
							delete fullSet.essentialMagicCode;
							delete fullSet.useMagicRaritiesNumber;
							
							// Build the regular set info
							var regSet = base.clone(fullSet, true);

							// Strip out extras from regular set
							regSet.cards.forEach(stripCardInfo);

							// Save each individual set
							tiptoe(
								function() {
									saveSet(set, regSet, fullSet, this);
								},
								function() {
									if (set == 'CON')
										saveSet('_CON', regSet, fullSet, this);
									else
										this();
								},
								function (setSize, fullSetSize) {
									dustSetData.size = setSize;
									dustSetData.sizeX = fullSetSize
									dustData.sets.push(dustSetData);

									this();
								},
								function(err) {
									allSets[set] = regSet;
									allSetsWithExtras[set] = fullSet;

									callback(err);
								}
							);
						},
						this);
					},
					function() {
						// All Sets
						var self = this;
						saveSet('AllSets', allSets, allSetsWithExtras, function(err, size, fullSize) {
							dustData.allSize = size;
							dustData.allSizeX = fullSize;

							self(err);
						});
					},
					function() {
						// All Sets Array
						var allSetsArray = [];
						var allSetsWithExtrasArray = [];

						base.info("- Generating allSetsArray");

						Object.keys(allSets).forEach(function(key) {
							allSetsArray.push(allSets[key]);
						});
						Object.keys(allSetsWithExtras).forEach(function(key) {
							allSetsWithExtrasArray.push(allSetsWithExtras[key]);
						});

						saveSet('AllSetsArray', allSetsArray, allSetsWithExtrasArray, this);
					},
					function() {
						base.info("- Generating allCards");

						var self = this;
						// All Cards
						var allCards = {};
						var allCardsWithExtras = {};

						// Each set...
						Object.keys(allSetsWithExtras).forEach(function(setCode) {
							// Each card...
							allSetsWithExtras[setCode].cards.forEach(function(card) {
								if (!allCardsWithExtras.hasOwnProperty(card.name)) {
									allCardsWithExtras[card.name] = card;
									allCards[card.name] = stripCardInfo(card);
								}
							});
						});

						// Save
						saveSet('AllCards', allCards, allCardsWithExtras, function(err, size, fullSize) {
							dustData.allCardsSize = size;
							dustData.allCardsSizeX = fullSize;

							self(err);
						});
					},
					function (err) {
						if (!err)
							base.error('- Done saving JSON.');
						self(err);
					}
				);
			},
			function() {
				// Load Changelog
				fs.readFile(path.join(__dirname, 'changelog.json'), { encoding: 'utf8'}, this);
			},
			function(changelogData) {
				changeLog = JSON.parse(changelogData);

				dustData.changeLog = changeLog.map(function(o, i) {
					o.whenAtom = moment(o.when, "YYYY-MM-DD").format("YYYY-MM-DDTHH:mm:ss");
					o.whenSiteMap = o.when;
					o.when = moment(o.when, "YYYY-MM-DD").format("MMM D, YYYY");
					o.uniqueID = changeLog.length-i;
					o.atomContent = "<p>Changes:<br><ul>" + o.changes.map(function(change) { return "<li>" + change + "</li>"; }).join("") + "</ul></p>";
					return o;
				});

				dustData.changeLogAtom = dustData.changeLog.slice(0, 9);

				dustData.lastUpdatedAtom = dustData.changeLog[0].whenAtom;
				dustData.lastUpdated = dustData.changeLog[0].when;
				dustData.lastUpdatedSiteMap = dustData.changeLog[0].whenSiteMap;
				dustData.version = dustData.changeLog[0].version;
				dustData.setSpecificFields = C.SET_SPECIFIC_FIELDS.sort().join(", ");

				// Save Website Files
				saveDust(dustData, this);
			},
			function() {
				// Final JSON stuff
				tiptoe(
					function() {
						// SetCodes.json
						var setCodes = C.SETS.map(function(SET) { return(SET.code); });
						saveSet('SetCodes', setCodes, null, this);
					},
					function() {
						// SetList.json
						var setList = C.SETS.map(function(SET) { return({ name : SET.name, code : SET.code, releaseDate : SET.releaseDate}); });
						saveSet('SetList', setList, null, this);
					},
					function() {
						// version-full.json
						saveSet('version-full', { version: dustData.version }, null, this);
					},
					function() {
						// version.json
						saveSet('version', dustData.version, null, this);
					},
					function() {
						// changelog.json
						saveSet('changelog', changeLog, null, this);
					},
					this
				);

				// TODO: This.
				//runUtil.run("zip", ["-9", "AllSetFiles.zip"].concat(C.SETS.map(function(SET) { return SET.code + ".json"; })), { cwd:  path.join(__dirname, "json"), silent : true }, this.parallel());
				//runUtil.run("zip", ["-9", "AllSetFiles-x.zip"].concat(C.SETS.map(function(SET) { return SET.code + "-x.json"; })), { cwd:  path.join(__dirname, "json"), silent : true }, this.parallel());
				//runUtil.run("zip", ["-9", "AllSetFilesWindows.zip"].concat(C.SETS.map(function(SET) { return (SET.code==="CON" ? "_" : "") + SET.code + ".json"; })), { cwd:  path.join(__dirname, "json"), silent : true }, this.parallel());				
			},
			function (err) {
				if (err) {
					base.error("Error!");
					base.error(err);
					throw(err);
				}
				base.info('done.');

				// Finish
				if (callback)
					callback(err);
			}
		);
	};

})(exports);

exports.generate();
