// server.js
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store whiteboard data and users
const boards = new Map();

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
    let boardId = null;
    let userId = `user-${Math.random().toString(36).substr(2, 8)}`;
    let userColor = getRandomColor();

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'join':
                boardId = data.boardId;
                if (!boards.has(boardId)) {
                    boards.set(boardId, {
                        paths: [],
                        users: new Map()
                    });
                }
                boards.get(boardId).users.set(userId, {
                    ws,
                    name: data.name || `User ${boards.get(boardId).users.size + 1}`,
                    color: userColor
                });
                sendInitialState(ws, boardId);
                broadcastUserList(boardId);
                break;
                
            case 'draw':
                if (boards.has(boardId)) {
                    boards.get(boardId).paths.push({
                        points: data.points,
                        color: userColor,
                        userId
                    });
                    broadcast(boardId, data);
                }
                break;
                
            case 'clear':
                if (boards.has(boardId)) {
                    boards.get(boardId).paths = [];
                    broadcast(boardId, data);
                }
                break;
        }
    });

    ws.on('close', () => {
        if (boardId && boards.has(boardId)) {
            boards.get(boardId).users.delete(userId);
            broadcastUserList(boardId);
        }
    });
});

function sendInitialState(ws, boardId) {
    if (boards.has(boardId)) {
        ws.send(JSON.stringify({
            type: 'init',
            paths: boards.get(boardId).paths,
            userId: userId
        }));
    }
}

function broadcast(boardId, data) {
    if (!boards.has(boardId)) return;
    
    const board = boards.get(boardId);
    board.users.forEach((user) => {
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(data));
        }
    });
}

function broadcastUserList(boardId) {
    if (!boards.has(boardId)) return;
    
    const board = boards.get(boardId);
    const users = Array.from(board.users.values()).map(user => ({
        name: user.name,
        color: user.color
    }));
    
    board.users.forEach((user) => {
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify({
                type: 'users',
                users
            }));
        }
    });
}

function getRandomColor() {
    const colors = [
        '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', 
        '#536DFE', '#448AFF', '#40C4FF', '#18FFFF', 
        '#64FFDA', '#69F0AE', '#B2FF59', '#EEFF41', 
        '#FFFF00', '#FFD740', '#FFAB40', '#FF6E40'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});