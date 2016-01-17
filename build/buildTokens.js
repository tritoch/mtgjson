var fs = require('fs'),
	path = require('path'),
    xml2js = require('xml2js');
 
var parser = new xml2js.Parser();
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
    		if (!token.set) {
    			console.warn("Token has no set:");
    			console.warn(JSON.stringify(token, null, '  '));
    		}
    		else {
	    		var set = token.set.map(function(setInfo) {
	    			return(setInfo['_']);
	    		});
	    		token.sets = set;
	    		delete token.set;
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
    	});


    	fs.writeFile(path.join(__dirname, '..', 'tokens', 'tokens.json'), JSON.stringify(out, null, '  '), 'utf8');
        //console.log(JSON.stringify(result, null, '  '));
        console.log('Done');
    });
});