'use strict';

Array.prototype.forEachCallback = function(callback, finishCallback) {
	var current = 0;
	var self = this;

	function next(err) {
		if (err) {
			console.error("Something is wrong on forEachCallback().");
			console.error(err);
		}

		if (!self) {
			console.log("Something went wrong...");
			throw('No self!');
			return;
		}
		if (current >= self.length) {
			if (finishCallback) {
				var cb = finishCallback.bind(self);
				cb(err);
			}
			return;
		}

		var currentItem = self[current++];
		
		var cb = callback.bind(currentItem);
		cb(currentItem, next);
	}

	// Start!
	next();
};

var exports = {};

(function(exports) {
	// Requires
	var fs = require('fs');
	var path = require('path');
	var rimraf = require('rimraf');

	var printUtil = require("xutil").print;
	var base = require('xbase');
	var tiptoe = require('tiptoe');

	// MTGJson requires
	var C = require('C');
	var shared = require('shared');

	// Module internaldata
	var JSONP_PREFIX = "mtgjsoncallback(";
	var JSONP_SUFFIX = ");";
	var allData = null;

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
		C.SETS.forEachCallback(
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

		tiptoe(
			function() {
				fs.writeFile(outPath + '.json', JSON.stringify(regularSet), { encoding: 'utf8' }, this);
			},
			function() {
				fs.writeFile(outPath + '-x.json', JSON.stringify(fullSet), { encoding: 'utf8' }, this);
			},
			// JSONP
			function() {
				fs.writeFile(outPath + '.jsonp', jsonp(JSON.stringify(regularSet)), { encoding: 'utf8' }, this);
			},
			function() {
				fs.writeFile(outPath + '-x.jsonp', jsonp(JSON.stringify(fullSet)), { encoding: 'utf8' }, this);
			},
			callback
		);
	};

	// Strips "extra" info from given card
	var stripCardInfo = function(card) {
		C.EXTRA_FIELDS.forEach(function(EXTRA_FIELD) {
			delete card[EXTRA_FIELD];
		});
	};

	// Methods
	exports.generate = function(callback) {
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
						Object.keys(sets).forEachCallback(function(set, callback) {
							var fullSet = sets[set];

							delete fullSet.isMCISet;
							delete fullSet.magicRaritiesCode;
							delete fullSet.essentialMagicCode;
							delete fullSet.useMagicRaritiesNumber;
							
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
						saveSet('AllSets', allSets, allSetsWithExtras, this);
					},
					function() {
						// All Sets Array
						var allSetsArray = [];
						var allSetsWithExtrasArray = [];

						console.log("- Generating allSetsArray");

						Object.keys(allSets).forEach(function(key) {
							allSetsArray.push(allSets[key]);
						});
						Object.keys(allSetsWithExtras).forEach(function(key) {
							allSetsWithExtrasArray.push(allSetsWithExtras[key]);
						});

						saveSet('AllSetsArray', allSetsArray, allSetsWithExtrasArray, this);
					},
					function() {
						console.log("- Generating allCards");
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
						saveSet('AllCards', allCards, allCardsWithExtras, this);
					},
					function (err) {
						if (!err)
							console.log('- Done saving JSON.');
						self(err);
					}
				);
			},
			function (err) {
				if (err) {
					console.log("Error!");
					console.log(err);
					throw(err);
				}
				console.log('done.');
				// Finish
				if (callback)
					callback(err);
			}
		);
	};

})(exports);

exports.generate();