//Hello
var kriegspiel = (function() {

	var _variant = {'occupies':true};
	var _colors  = {'w':'white','b':'black'};
	var _colorx  = {'white':'black','black':'white'};
	var _socket  = io.connect('http://'+document.domain);
	var _gameid  = location.href.substr(location.href.indexOf('/games/')+7);

	var _active  = false; //Your turn is active or not
	
	var _color; //Your color
	var _oppos; //Your opponents color
	var _board; //Your board
	var _p,_o;  //First chars of your color and opponents color
	var _temp;  //Temporary position to reset illegal moves

	//Finite State Machine for the options available to the user on the move
	var _movestate = (function(){
		var movestate = function(){this.reset()};
			movestate.prototype = {
				okOccupies:function(){ return this.occupies<0; },
				isOccupies:function(){ return this.occupies===0; },
				doOccupies:function(){ return ++this.occupies; },
				okDrawOffer:function(){ return this.drawoffer<0; },
				isDrawOffer:function(){ return this.drawoffer===0; },				
				doDrawOffer:function(){ return ++this.drawoffer; },
				okPawnCaptures:function(){ return this.pawncaptures<0; },
				isPawnCaptures:function(){ return this.pawncaptures===0; },
				doPawnCaptures:function(){ return ++this.pawncaptures; },
				reset : function(){			
					this.occupies=-1;
					this.pawncaptures=-1;
					this.drawoffer=-1;
				},
				serialize:function(){
					var self=this;
					return {
						occupies:self.occupies,
						pawncaptures:self.pawncaptures,
						drawoffer:self.drawoffer
					};
				},
				deserialize:function(states){
					var self=this;
					self.occupies=states.occupies;
					self.pawncaptures=states.pawncaptures;
					self.drawoffer=states.drawoffer;
				}
			};
		return new movestate();
	})();

	//Common board functions:
	var ranks = '1,2,3,4,5,6,7,8'.split(',');
	var files = 'a,b,c,d,e,f,g,h'.split(','); 
	var getFile  = function(f){ return f.charCodeAt(0)-97; }  //returns array index of file letter
	var getRank  = function(r){ return parseInt(r)-1; } //returns array index of rank number

	//Initializes the color variables
	var setcolor = function(color) {
		_color = color;
		_oppos = _colorx[color];
		_p = _color.charAt(0);
		_o = _oppos.charAt(0);
	}
	
	//Resets the movestate	
	var freshmove = function() {
	}
	
	//Announces a message to the player
	var announce = function(data,noscroll) {
		var $list = $("#console > ul");
		var $console = $("#console");
		var whoclass = data.who+"-message";
		var whatclass = data.who+"-"+data.type;
		if (data.type!=="welcome" || $list.find("li."+whatclass).length===0) {
			var $message = $("<li class='"+ whoclass + " " + whatclass +"' data-type='" + data.type + "'>"+data.message+"</li>")
			$list.append($message);
			if(!noscroll) setTimeout(function(){
				var $last = $list.find("li:last");
				var top = Math.floor($last.offset().top + $last.height());
				$console.animate({scrollTop:top},500);
			},100);
		} else if (data.type==="welcome" && data.username) {
			$("#player"+data.who).text(data.username);
		}
	};

	//Activates player's ability to move
	var activate = function() {
		if(!_active) _movestate.reset(); 
		_active=true;
	}
	
	//Deactivates player's ability to move
	var deactivate = function() {
		_active=false;
	}

	//Returns a scratch FEN string of only the opponents pieces
	var getscratch = function(position) {
		var scratch = {};
		for(var i in position) {
			if(position.hasOwnProperty(i) && position[i].charAt(0)===_o) {
				scratch[i]=position[i];
			} 
		}
		return ChessBoard.objToFen(scratch);
	};

	//Clear the console and load a list of messages
	var loadmessages = function(messages) {
		var $list = $("#console > ul");
		$list.children().remove();
		for(var i=0,l=messages.length;i<l;i++) {
			announce(messages[i],i!==(l-1));
		}
	}
	
	//Loads the user's position and the scratch opponent placements
	var loadposition = function(position,scratch) {
		var pos = {};
		if(position&&scratch) {
			//Construct a combination of the player's own position and scratch opponent pieces
			var player = ChessBoard.fenToObj(position);
			var opponent = ChessBoard.fenToObj(scratch);
			for(var i in player) {
				if(player.hasOwnProperty(i) && player[i].charAt(0)===_p) pos[i]=player[i]; 
			}
			for(var i in opponent) {
				if(opponent.hasOwnProperty(i) && opponent[i].charAt(0)===_o) pos[i]=opponent[i]; 
			}
		} else if (position){
			//No scratch available
			pos = position;
		} else {
			//Clean slate
			pos = 'start'
		}
		
		//Set up the pieces
		_board.position(pos,false);
	}
	
	//Loads the movestate from the server, and disables actions if necessary
	var loadmovestate = function(state) {
		_movestate.deserialize(state);
		/*
		if(!_movestate.okPawnCaptures()) { $("#pawncaptures").disable(); }
		if(!_movestate.okDrawOffer()) { $("#offerdraw").disable(); }
		if(!_movestate.okOccupies()) { $("#occupies").disable(); }
		*/
	}
		
	//-----------------------------------------
	//Socket Events
	var onMove = function (data) {
		announce(data); 
		if (data.action === 'start') activate();
		else deactivate();
	};
	
	var onCapture = function (data) {
		announce(data);
		if (data.who !== _color) _board.trash(data.square);
		if (data.action === 'start') activate();
		else deactivate();
	};

	var onGameover = function (data) {
		announce(data);
		if (data.action === 'start') activate();
		else deactivate();
	}

	var onImpossible = function (data) {
		announce(data);
		if (data.action === 'start') {
			_board.position(_temp);
			activate();
		} else {
			deactivate();
		}
	}

	var onIllegal = function (data) {
		announce(data);
		if (data.action === 'start') {
			_board.position(_temp);
			activate();
		} else {
			deactivate();
		}
	}
	
	var onEnd = function (data) {
		announce(data);
	}

	//Fired when player joins
	var onKriegspiel = function(data) {

		setcolor(data.color);

		$("#wait").remove();
		$("#board").show();

		if(!_board) {
			_board = new ChessBoard('board', {
			  draggable: true,
			  dropOffBoard: 'trash',
			  sparePieces: true,
			  onDrop:drop,
			  orientation: _color,
			  fade: _o
			}); 

			_board.start(false);

			$(".spare-pieces-bottom-ae20f").hide();
		}
		
		var turn = 'white';
		if (data.game) {
			turn = _colors[data.game.turn||'w'];
			loadposition(data.game.position,data.game.scratch);
			loadmessages(data.game.messages||[]);			
		}

		if (_color===turn) activate();
		if (data.game) loadmovestate(data.game[turn+'state']);
		
	};

	//-----------------------------------------
	//Client events	
	var nobubble = function(e) { e.preventDefault&&e.preventDefault(); e.stopPropagation&&e.stopPropagation(); return false;};

	//Moves a piece on the server
	var move = function(source, target, piece, newPos, oldPos, orientation) {
		_socket.emit('move',{gameid:_gameid,source:source,target:target,scratch:getscratch(newPos)});
		deactivate();
	}

	//Piece was dropped on the chessboard
	var drop = function(source, target, piece, newPos, oldPos, orientation) {
		var color = piece.charAt(0);
		if (color!==_color.charAt(0)) {
			//Player is just messing around with opposing pieces
			return true;
		} if (!_active) {
			//Not your turn!
			return 'snapback';
		} else if(source === 'spare') {
			//No spares for you!
			return 'snapback';
		} else if (target === 'offboard') {
			//No trash for you!
			return 'snapback';
		} else {
			//Attempt a move
			_temp = oldPos;
			move(source, target, piece, newPos, oldPos, orientation);
		}
	}

	
	var doPawncaptures = function(e){
		console.log(_movestate.okPawnCaptures());
		if(_active && _movestate.okPawnCaptures()) {
			_socket.emit('pawncaptures',{gameid:_gameid});
			_movestate.doPawnCaptures();
		}	
		return nobubble(e);
	};


	var clearOccupies = function() {
		for(var f=0;f<8;f++) { 
			for(var r=0;r<8;r++) { 
				$('.square-'+files[f]+ranks[r]).removeClass('highlight-square').removeClass('highlight-occupies');
			}
		} 
	}

	var doOccupiesSquare = function(e) {
		clearOccupies();
		if(_active && _variant.occupies) {
			var square = $(this).attr("data-square");
			_socket.emit('occupies',{gameid:_gameid,target:square});
		}
		return nobubble(e);
	}

	var doOccupies = function(e){
		clearOccupies();
		if(_active && _variant.occupies && _movestate.okOccupies()) {
			_movestate.doOccupies();
			var f,r;
			var position = _board.position();
			var hasPiece = function(sq) { return (position.hasOwnProperty(sq) && position[sq].charAt(0)===_p)?true:false; }
			var addAdj   = function(fx,ry) { 
				if(fx && ry && !hasPiece(fx+ry)) {
					$('.square-'+ fx+ry).attr("data-square",fx+ry).addClass('highlight-square').addClass('highlight-occupies'); 
				}
			};
			for(var sq in position) {
				if (hasPiece(sq)) {
					f = getFile(sq.charAt(0));
					r = getRank(sq.charAt(1));
					for(var x=-1;x<=1;x++) {
						for(var y=-1;y<=1;y++) {
							if(x||y) addAdj(files[f+x],ranks[r+y]);			
						}
					}
				}
			}
		}
		return nobubble(e);
	};

	var doOfferdraw = function(e){
		return nobubble(e);
	};

	var doResign = function(e){
		return nobubble(e);
	};

	//-----------------------------------------
	//Bind events	
	_socket.on('welcome', announce);
	_socket.on('pawncaptures', announce);
	_socket.on('occupies', announce);
	_socket.on('offerdraw', announce);	
	_socket.on('acceptdraw', announce);	
	_socket.on('declinedraw', announce);	
	_socket.on('kriegspiel', onKriegspiel);
	_socket.on('impossible', onImpossible);
	_socket.on('gameover', onGameover);	
	_socket.on('illegal', onIllegal);
	_socket.on('capture', onCapture);
	_socket.on('check', announce);
	_socket.on('move', onMove);
	_socket.on('end', onEnd);
	
	//-----------------------------------------
	//Trigger event to join the game
	_socket.emit('join',{gameid:_gameid});
	
	//-----------------------------------------
	//Trigger events from buttons
	$("#pawncaptures").on("click",doPawncaptures);
	$("#occupies").on("click",doOccupies);
	$("#offerdraw").on("click",doOfferdraw);
	$("#resign").on("click",doResign);

	$("#board").on("click",".highlight-occupies",doOccupiesSquare);

})();