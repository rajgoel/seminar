const path = require('path');
const http = require('http');
const express = require('express');
const socketio = require('socket.io');
const moment = require('moment');
var cors = require('cors');

const app = express();
//app.use(cors());
//app.use(cors({ credentials: true }));

const server = http.createServer(app);
const io = socketio(server);

// Set root for URL
app.use(express.static(path.join(__dirname, '/www/')));


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
function getRoomIndex(url,name,hash) {
	return rooms.findIndex(room => room.url === url && room.name === name && room.hash === hash);
}

function label(room) {
	return room.url + "|" + room.name + "|" + room.hash;
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

	// Open a new room or join as host
	function hostRoom( url, name, hash, secret, callback ) {
		if ( !url ) {
			if ( callback ) callback("No URL provided");
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


		const user = getUser(socket.id);
		const i = getRoomIndex(url,name,hash);

		if (i !== -1) {
			// join existing room as host
console.log(`${socket.id} joins room "${url}|${name}|${hash}" as host`);
			hosts[i].push(user);
			participants[i].push(user);
			socket.join( label(rooms[i]) );

			socket.broadcast.to( label(rooms[i]) ).emit( 'entered_room', { room: rooms[i], user }); // send to everyone else in room
			socket.emit( 'participants', { room: rooms[i], hosts: hosts[i], participants: participants[i] } ); // send participant list to user
		}
		else {
			// open new room
console.log(`${socket.id} opens room "${url}|${name}|${hash}"`);
			room = { url, name, hash };
			rooms.push(room);
			hosts.push( [ user ] );
			participants.push( [ user ] );
			socket.join( label(room) );
			io.emit( 'room_opened', { url: room.url, name: room.name } ); // broadcast to everyone
			socket.emit( 'chair', room ); // tell host to chair the room
//console.log(rooms, hosts, participants);
 		}

		if ( callback ) callback();
		return room;
	}

	// Enter room as participant
	function enterRoom( i, callback ) {
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return;
		}

console.log(`${socket.id} enters room "${rooms[i].url}|${rooms[i].name}|${rooms[i].hash}"`);
		const user = getUser(socket.id);
		participants[i].push(user);	

		socket.join( label(rooms[i]) );
		socket.broadcast.to( label(rooms[i]) ).emit( 'entered_room', { room: rooms[i], user } ); // send to everyone else in room
		socket.emit( 'participants', { room: rooms[i], hosts: hosts[i], participants: participants[i] } ); // send participant list to user
//console.log(rooms, hosts, participants);
		if ( callback ) callback();
	}

	// Leave room
	function leaveRoom( i, callback ) {
//console.log("leaveRoom",i);
		if ( i === -1 ) {
//console.log("Room not found");
			if ( callback ) callback("Room not found");
			return;
		}

		const user = getUser(socket.id);

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
//console.log("Only participants can leave a room");
			return false;		
		}

//console.log(socket.id);		
		if ( !hosts[i].length ) {
console.log(`${socket.id} closes room "${rooms[i].url}|${rooms[i].name}|${rooms[i].hash}"`);
			// close room because user was the last host 
			socket.broadcast.to( label(rooms[i]) ).emit( 'kicked_out', rooms[i] ); // send to everyone else in room
			socket.leave( label(rooms[i]) );

			io.emit( 'room_closed', { url: rooms[i].url, name: rooms[i].name } ); // broadcast to everyone
			deleteRoom(i);
		}
		else {
console.log(`${socket.id} leaves room "${rooms[i].url}|${rooms[i].name}|${rooms[i].hash}"`);
			socket.leave( label(rooms[i]) );
			// broadcast to everyone in room
			io.to( label(rooms[i]) ).emit( 'left_room', { room: rooms[i], user } ); 
			if ( chair ) {
				io.to( hosts[i][0].id ).emit( 'chair', room ); // tell first of the remaining hosts to chair the room
			}

		}
//console.log("Callback:", callback);
		if ( callback ) callback();
	}

	// Delete user
	function leaveAllRooms(id) {
//console.log("Leave all rooms", id);
		// leave all rooms the user is
		for (var i = rooms.length-1; i >= 0; i--) {
//console.log("Leave room", participants[i],participants[i].findIndex(user => user.id === id));
			if ( participants[i].findIndex(user => user.id === id) !== -1 ) {
				leaveRoom( i );
			}
		}
	}

/*
	// Only close room if user is host
	function closeRoom( i, callback ) {
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return;
		}
		const user = getUser(socket.id);		
		if ( hosts[i].findIndex(host => host.id === user.id) !== -1 ) {
console.log(`${socket.id} closes room "${url}|${name}|${hash}"`);
			socket.broadcast.to( label(rooms[i]) ).emit( 'kicked_out', rooms[i] ); // send to everyone else in room
			io.sockets.clients( label(rooms[i]) ).forEach( function(client) { client.leave( label(rooms[i]) ) }); // kick out everyone in the room
			io.emit( 'room_closed', { url: rooms[i].url, name: rooms[i].name } ); // broadcast to everyone
			deleteRoom(i); 
		}
		else {
			if ( callback ) callback("Only hosts may close rooms");
		}
		if ( callback ) callback();
	}
*/

	// Send message
	function sendMessage( type, i, recipient, copy, content, callback ) {
//console.log("Message:", type, i, recipient, copy, content, hosts[i][0]);
		if ( recipient === true ) {
			// make chair the default recipient
			recipient = hosts[i][0].id;
		}
//console.log("Message to ", recipient);
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return;
		}
		const user = getUser(socket.id);
		if ( recipient ) {
			// recipient must be participant in the room
			const j = participants[i].findIndex(participant => participant.id === recipient);
			if ( j !== -1 ) {
//console.log("Recipient: " +  recipient,  content);
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
//console.log("Recipients: all",  content);
			// send to everyone in the room
			io.to( label(rooms[i]) ).emit(type, { time: moment().format('h:mm:ss'), room: rooms[i], sender: user, content: content} );
		}
		else {
//console.log("Recipients: everyone else", content);
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

	socket.on('host_room', ({ url, name, hash, secret }, callback) => {
		hostRoom( url, name, hash, secret, callback );
	});
/*
	socket.on('close_room', ({ url, name, hash }, callback) => {
		closeRoom( getRoomIndex(url,name,hash), callback);
	});
*/
	socket.on('leave_room', ({ url, name, hash }, callback) => {
		leaveRoom( getRoomIndex(url,name,hash), callback );
	});

	socket.on('join_room', ({ url, name, hash }, callback) => {
		enterRoom( getRoomIndex(url,name,hash), callback);
	});

	socket.on('message', ( {url, name, hash, recipient, copy, content}, callback ) => {
		const i = getRoomIndex(url,name,hash);
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return;
		}
console.log(`${socket.id} sends message to "${recipient}"`, content);
		// participants can send messages to all participants in the room
		sendMessage( 'message', i, recipient, copy, content, callback );
	});

	socket.on('announcement', ( {url, name, hash, recipient, copy, content}, callback ) => {
		const i = getRoomIndex(url,name,hash);
		if ( i === -1 ) {
			if ( callback ) callback("Room not found");
			return;
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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
