const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const socketio = require('socket.io');
const moment = require('moment');
var cors = require('cors');
const app = express();
app.use(cors({ credentials: true, origin: true }));
// Set root for URL
app.use(express.static(path.join(__dirname, '/www/')));

var server;

const args = process.argv.slice(2);
if (args.length < 2 ) {
  // no ssl key and certificate provided => use http
  server = http.createServer(app);
}
else {
  // path of ssl key and certificate provided => use https
  var fs = require('fs');
  var privateKey = fs.readFileSync(args[0]);
  var certificate = fs.readFileSync(args[1]);
  var credentials = {key: privateKey, cert: certificate};
  server = https.createServer(credentials,app);
}

const io = socketio(server);



/**
Authorisation
**/
const bcrypt = require('bcrypt');
function createHash( secret ) {
	return bcrypt.hashSync( secret, 10);
}

function authorise( hash, secret ) {
	return bcrypt.compareSync(secret, hash);
}

/*
console.log("Hash", createHash('123456') );
console.log("Hash", createHash('123456') ); // hash should differ from first
console.log("Authorize", authorise('$2a$05$hhgakVn1DWBfgfSwMihABeYToIBEiQGJ.ONa.HWEiNGNI6mxFCy8S','123456') );
*/

const users = [];
const rooms = [];
const hosts = [];
const participants = [];

// Get room index
function getRoomIndex(venue,name,hash) {
	return rooms.findIndex(room => room.venue === venue && room.name === name && room.hash === hash);
}

function label(room) {
	return room.venue + "|" + room.name + "|" + room.hash;
}

// Get user
function getUser(id) {
	return users.find(user => user.id === id);
}

// Delete room
function deleteRoom(i) {
	if (i !== -1) {
		rooms.splice(i, 1)[0];
		hosts.splice(i, 1)[0];
		participants.splice(i, 1)[0];
	}
}

// Delete user
function deleteUser(id) {
	const i = users.findIndex(user => user.id === id);
	if (i !== -1) {
		users.splice(i, 1)[0];
	}
}


// Run when client connects
io.on('connection', socket => {
console.log(`${socket.id} connected`);
	socket.emit( 'rooms', rooms ); // send list of rooms

	// Create user
	function createUser(name, callback) {
		if ( !getUser(socket.id) ) {
console.log(`${socket.id} checked in with name "${name}"`);
			const user = { id: socket.id, name: name };
			users.push(user);
			if ( callback ) callback();
		}
		else  {
			if ( callback ) callback("User already exists");
		}
	}

	function validate(venue, name, hash, secret, callback) {
		if ( !venue ) {
			if ( callback ) callback("No venue provided");
			return false;
		}
		if ( !name ) {
			if ( callback ) callback("No room name provided");
			return false;
		}
		if ( !hash ) {
			if ( callback ) callback("No hash provided");
			return false;
		}
		if ( !authorise( hash, secret ) ) {
			if ( callback ) callback("Authorisation failed");
			return false;
		}	
		return true;
	}

	// Open a new room or join as host
	function hostRoom( venue, name, hash, secret, callback ) {
		if ( !validate(venue, name, hash, secret, callback) ) return false;

		const user = getUser(socket.id);
		if ( !user ) {
			callback("User not found!");
			return false;
		}

		const i = getRoomIndex(venue,name,hash);

		if (i !== -1) {
			// join existing room as host
console.log(`${socket.id} joins room "${venue}|${name}|${hash}" as host`);
			hosts[i].push(user);
			participants[i].push(user);
			socket.join( label(rooms[i]) );

			socket.broadcast.to( label(rooms[i]) ).emit( 'entered_room', { room: rooms[i], user }); // send to everyone else in room
			socket.emit( 'participants', { room: rooms[i], hosts: hosts[i], participants: participants[i] } ); // send participant list to user
		}
		else {
			// open new room
console.log(`${socket.id} opens room "${venue}|${name}|${hash}"`);
			room = { venue, name, hash };
			rooms.push(room);
			hosts.push( [ user ] );
			participants.push( [ user ] );
			socket.join( label(room) );
			io.emit( 'room_opened', { venue: room.venue, name: room.name } ); // broadcast to everyone
			socket.emit( 'chair', room ); // tell host to chair the room
//console.log(rooms, hosts, participants);
 		}

		if ( callback ) callback();
		return room;
	}

	function closeRoom( venue, name, hash, secret, callback ) {
		if ( !validate(venue, name, hash, secret, callback) ) return false;

		var i = getRoomIndex(venue,name,hash);
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return;
		}

console.log(`${socket.id} closes room "${rooms[i].venue}|${rooms[i].name}|${rooms[i].hash}"`);
		io.to( label(rooms[i]) ).emit( 'kicked_out', rooms[i] ); // send to everyone in room
		io.emit( 'room_closed', { venue: rooms[i].venue, name: rooms[i].name } ); // broadcast to everyone

		socket.leave( label(rooms[i]) );

		deleteRoom(i);

		if ( callback ) callback();
		return;
	}

	// Enter room as participant
	function enterRoom( i, callback ) {
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return false;
		}

console.log(`${socket.id} enters room "${rooms[i].venue}|${rooms[i].name}|${rooms[i].hash}"`);
		const user = getUser(socket.id);
		if ( !user ) {
			callback("User not found!");
			return false;
		}

		participants[i].push(user);	

		socket.join( label(rooms[i]) );
		socket.broadcast.to( label(rooms[i]) ).emit( 'entered_room', { room: rooms[i], user } ); // send to everyone else in room
		socket.emit( 'participants', { room: rooms[i], hosts: hosts[i], participants: participants[i] } ); // send participant list to user
		if ( callback ) callback();
	}

	// Leave room
	function leaveRoom( i, callback ) {
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return false;
		}

		const user = getUser(socket.id);
		if ( !user ) {
			callback("User not found!");
			return false;
		}

		const chair = ( user.id == hosts[i][0].id );
		// remove user from hosts
		const h = hosts[i].findIndex(host => host.id === user.id);
		if (h !== -1) {
			hosts[i].splice(h, 1)[0];
		}

		// remove user from participants
		const j = participants[i].findIndex(participant => participant.id === user.id);
		if (j !== -1) {
			participants[i].splice(j, 1)[0];
		}
		else {
			if ( callback ) callback("Only participants can leave a room");
			return false;		
		}

		if ( !hosts[i].length ) {
console.log(`${socket.id} closes room "${rooms[i].venue}|${rooms[i].name}|${rooms[i].hash}"`);
			// close room because user was the last host 
			socket.broadcast.to( label(rooms[i]) ).emit( 'kicked_out', rooms[i] ); // send to everyone else in room
			socket.leave( label(rooms[i]) );

			io.emit( 'room_closed', { venue: rooms[i].venue, name: rooms[i].name } ); // broadcast to everyone
			deleteRoom(i);
		}
		else {
console.log(`${socket.id} leaves room "${rooms[i].venue}|${rooms[i].name}|${rooms[i].hash}"`);
			socket.leave( label(rooms[i]) );
			// broadcast to everyone in room
			io.to( label(rooms[i]) ).emit( 'left_room', { room: rooms[i], user } ); 
			if ( chair ) {
				io.to( hosts[i][0].id ).emit( 'chair', room ); // tell first of the remaining hosts to chair the room
			}

		}
		if ( callback ) callback();
	}

	// Delete user
	function leaveAllRooms(id) {
		// leave all rooms the user is
		for (var i = rooms.length-1; i >= 0; i--) {
			if ( participants[i].findIndex(user => user.id === id) !== -1 ) {
				leaveRoom( i );
			}
		}
	}


	// Send message
	function sendMessage( type, i, recipient, copy, content, callback ) {
		if ( recipient === true ) {
			// make chair the default recipient
			recipient = hosts[i][0].id;
		}
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return false;
		}
		const user = getUser(socket.id);
		if ( !user ) {
			callback("User not found!");
			return false;
		}

		if ( recipient ) {
			// recipient must be participant in the room
			const j = participants[i].findIndex(participant => participant.id === recipient);
			if ( j !== -1 ) {
				// send to recipient
				io.to(recipient).emit(type, { time: moment().format('h:mm:ss'), room: rooms[i], sender: user, content: content} );
				if ( copy ) {
					// send copy to sender
					socket.emit(type, { time: moment().format('h:mm:ss'), room: rooms[i], sender: user, content: content} );
				}
			}
			else {
				if ( callback ) callback("Recipient not found");
				return false;
			}
		}
		else if ( copy ) {
			// send to everyone in the room
			io.to( label(rooms[i]) ).emit(type, { time: moment().format('h:mm:ss'), room: rooms[i], sender: user, content: content} );
		}
		else {
			// send to everyone else in the room
			socket.to( label(rooms[i]) ).emit(type, { time: moment().format('h:mm:ss'), room: rooms[i], sender: user, content: content} );
		}
		if ( callback ) callback();
	}

	socket.on('checkin', ( name , callback) => {
		createUser( name, callback );
	});

	socket.on('checkout', () => {
console.log(`${socket.id} checked out`);
		leaveAllRooms(socket.id);
		deleteUser(socket.id);
	});

	socket.on('host_room', ({ venue, name, hash, secret }, callback) => {
		hostRoom( venue, name, hash, secret, callback );
	});

	socket.on('close_room', ({ venue, name, hash, secret }, callback) => {
		closeRoom( venue, name, hash, secret, callback );
	});

	socket.on('leave_room', ({ venue, name, hash }, callback) => {
		leaveRoom( getRoomIndex(venue,name,hash), callback );
	});

	socket.on('join_room', ({ venue, name, hash }, callback) => {
		enterRoom( getRoomIndex(venue,name,hash), callback);
	});

	socket.on('message', ( {venue, name, hash, recipient, copy, content}, callback ) => {
		const i = getRoomIndex(venue,name,hash);
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return false;
		}
console.log(`${socket.id} sends message to "${recipient}"`, content);
		// participants can send messages to all participants in the room
		sendMessage( 'message', i, recipient, copy, content, callback );
	});

	socket.on('announcement', ( {venue, name, hash, recipient, copy, content}, callback ) => {
		const i = getRoomIndex(venue,name,hash);
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return false;
		}

		// hosts can send announcements to all participants in the room
		if ( hosts[i].findIndex(host => host.id === socket.id) !== -1 ) {
console.log(`${socket.id} makes announcemnet to "${recipient}"`, content);
			sendMessage( 'announcement', i, recipient, copy, content, callback );
		}
		else {
			if ( callback ) callback("Only hosts can make announcements");
		}
	});

	// Runs when client disconnects
	socket.on('disconnect', () => {
console.log(`${socket.id} disconnected`);
		leaveAllRooms(socket.id);
		deleteUser(socket.id);
	});
});

const PORT = process.env.PORT || 4433;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
