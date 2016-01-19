var fs = require('fs'),
	path = require('path'),
	hash = require("mhash"),
	C = require('C'),
	xml2js = require('xml2js');

var parser = new xml2js.Parser();
var tokenNames = {};

function getImageName(setCode, tokenName) {
	tokenName = tokenName.toLowerCase().trim();
	setCode = setCode.toLowerCase().trim();

	if (!tokenNames.hasOwnProperty(setCode)) {
		tokenNames[setCode] = {};
	}

	if (!tokenNames[setCode].hasOwnProperty(tokenName)) {
		tokenNames[setCode][tokenName] = 1;
		return(tokenName);
	}

	tokenNames[setCode][tokenName]++;
	return(tokenName + tokenNames[setCode][tokenName]);
}

fs.readFile(path.join(__dirname, '..', 'tokens', 'tokens.xml'), function(err, data) {
	parser.parseString(data, function (err, result) {
		var out = result.cockatrice_carddatabase.cards[0].card;

		out.forEach(function(token) {
			[ 'name', 'type', 'text', 'manacost' ].forEach(function(x) {
				if (token[x]) {
					if (Array.isArray(token[x]))
						token[x] = token[x][0];

					if (typeof(token[x]) === 'string') {
						if (token[x].length == 0)
							delete token[x];
						else
							token[x] = token[x].trim();
					}
				}
			});

			// Trim name
			token.name = token.name.replace(/ ?\([0-9]*\)/, '').trim();

			if (!token.set) {
				console.warn("Token has no set:");
				console.warn(JSON.stringify(token, null, '  '));
			}
			else {
				var tokenURLS = [];
				var set = token.set.map(function(setInfo) {
					if (!setInfo)
						return;
					if (!setInfo['_'])
						return;
					var url = setInfo['$']['picURL'];

					var imageName = getImageName(setInfo['_'], token.name);

					tokenURLS.push({
						"set": setInfo['_'],
						"url": url,
						"imageName": imageName,
						"id": hash("sha1", (setInfo['_'] + token.name + imageName))
					});
					return(setInfo['_']);
				});
				token.sets = set;
				delete token.set;
				token.urls = tokenURLS;
			}

			if (token.pt) {
				var x = token.pt[0].split('/');
				token.power = x[0];
				token.toughness = x[1];
				delete(token.pt);
			}

			if (token.tablerow) delete token.tablerow;

			if (token.token)
				delete token.token;

			// fix Colors
			if (token.color) {
				token.colors = token.color.map(function(c) {
					var color = C.SYMBOL_MANA[c.toLowerCase()][0];
					color = color.charAt(0).toUpperCase() + color.slice(1);
					return(color);
				});
				delete token.color;
			}

			// Make names consistent
			if (token['reverse-related']) {
				token.reverseRelated = token['reverse-related'];
				delete token['reverse-related'];
			}

		});

		// Write json output
		fs.writeFile(path.join(__dirname, '..', 'tokens', 'tokens.json'), JSON.stringify(out, null, '  '), 'utf8', function(err) {
			if (err) {
				console.error(err);
				throw(err);
			}

			console.log('Done');
		});
	});
});
