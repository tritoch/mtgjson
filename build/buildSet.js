"use strict";
/*global setImmediate: true*/

var base = require("xbase"),
	C = require("C"),
	fs = require("fs"),
	path = require("path"),
	shared = require("shared"),
	tiptoe = require("tiptoe"),
	rip = require("rip");

var setsToDo = shared.getSetsToDo();

setsToDo.removeAll(C.SETS_NOT_ON_GATHERER.concat(shared.getMCISetCodes()));

base.info("Doing sets: %s", setsToDo);

setsToDo.serialForEach(function(arg, subcb)
{
	var targetSet = C.SETS.mutateOnce(function(SET) { if(SET.name.toLowerCase()===arg.toLowerCase() || SET.code.toLowerCase()===arg.toLowerCase()) { return SET; } });
	if(!targetSet)
	{
		base.error("Set %s not found!", arg);
		return setImmediate(subcb);
	}

	if(targetSet.isMCISet)
	{
		base.error("Set %s is an MCI set, use importMCISet.js instead.", arg);
		return setImmediate(subcb);
	}

	tiptoe(
		function build() {
			rip.ripSet(targetSet.name, this);
		},
		function tokens(set) {
			// Fixes tokens before saving.
			var tokens = [];
			var cards = [];

			// Move tokens to their place.
			set.cards.forEach(function (c) {
				if (c.layout === 'token') {
					tokens.push(c);
				}
				else {
					cards.push(c);
				}
			});

			set.cards = cards;
			set.tokens = tokens;

			// Add missing tokens.
			var self = this;
			fs.readFile(path.join(__dirname, '..', 'tokens', 'tokens.json'), 'utf8', function(err, data) {
				if (err)
					return(setImmediate(function() { self(err); }));
				
				var tokens = JSON.parse(data);
				tokens.forEach(function(token) {
					if (token.sets.indexOf(set.code) >= 0) {
						// TODO: Check if token already exists
						set.tokens.push(token);
					}
				});

				self(null, set);
			});
		},
		function save(set) {
			shared.saveSet(set, this);
		},
		function finish(err) {
			subcb(err);
		}
	);
}, function exit(err)
{
	if(err)
	{
		base.error(err);
		process.exit(1);
	}

	process.exit(0);
});
