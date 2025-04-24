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

// Add online users set
const onlineUsers = new Set();

app.use(express.static(path.join(__dirname, 'public')));

// Add root route handler
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Function to broadcast online user count to all clients
function broadcastOnlineCount() {
    const count = onlineUsers.size;
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'onlineCount',
                count: count
            }));
        }
    });
}

wss.on('connection', (ws) => {
    let boardId = null;
    let userId = `user-${Math.random().toString(36).substr(2, 8)}`;
    let userColor = getRandomColor();

    // Add user to online users set
    onlineUsers.add(userId);
    console.log(`User connected: ${userId} (Total users: ${onlineUsers.size})`);
    broadcastOnlineCount();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'join':
                    boardId = data.boardId;
                    if (!boards.has(boardId)) {
                        boards.set(boardId, {
                            paths: [],
                            users: new Map(),
                            textContent: '',
                            cursorPositions: new Map(),
                            lastUpdate: Date.now()
                        });
                    }
                    boards.get(boardId).users.set(userId, {
                        ws,
                        name: data.name || `User ${boards.get(boardId).users.size + 1}`,
                        color: userColor
                    });
                    sendInitialState(ws, boardId, userId);
                    broadcastUserList(boardId);
                    break;
                    
                case 'text':
                    if (boards.has(boardId)) {
                        const board = boards.get(boardId);
                        const { text, position, action } = data;
                        
                        // Update board content
                        switch (action) {
                            case 'insert':
                                board.textContent = insertTextAtPosition(board.textContent, text, position);
                                break;
                            case 'delete':
                                board.textContent = deleteTextAtPosition(board.textContent, position);
                                break;
                            case 'replace':
                                board.textContent = text;
                                break;
                        }
                        
                        // Update cursor position
                        board.cursorPositions.set(userId, position);
                        board.lastUpdate = Date.now();
                        
                        // Broadcast to all users
                        broadcast(boardId, {
                            type: 'text',
                            text: board.textContent,
                            position: position,
                            action: action,
                            userId: userId,
                            cursorPositions: Array.from(board.cursorPositions.entries()),
                            timestamp: board.lastUpdate
                        });
                    }
                    break;
                    
                case 'cursor':
                    if (boards.has(boardId)) {
                        const board = boards.get(boardId);
                        board.cursorPositions.set(userId, data.position);
                        board.lastUpdate = Date.now();
                        
                        broadcast(boardId, {
                            type: 'cursor',
                            userId: userId,
                            position: data.position,
                            cursorPositions: Array.from(board.cursorPositions.entries()),
                            timestamp: board.lastUpdate
                        });
                    }
                    break;
                    
                case 'draw':
                    if (boards.has(boardId)) {
                        const board = boards.get(boardId);
                        board.paths.push({
                            points: data.points,
                            color: userColor,
                            userId,
                            timestamp: Date.now()
                        });
                        board.lastUpdate = Date.now();
                        broadcast(boardId, {
                            ...data,
                            timestamp: board.lastUpdate
                        });
                    }
                    break;
                    
                case 'clear':
                    if (boards.has(boardId)) {
                        const board = boards.get(boardId);
                        board.paths = [];
                        board.textContent = '';
                        board.cursorPositions.clear();
                        board.lastUpdate = Date.now();
                        broadcast(boardId, {
                            type: 'clear',
                            userId: userId,
                            timestamp: board.lastUpdate
                        });
                    }
                    break;
                    
                case 'sync':
                    if (boards.has(boardId)) {
                        const board = boards.get(boardId);
                        ws.send(JSON.stringify({
                            type: 'sync',
                            textContent: board.textContent,
                            paths: board.paths,
                            cursorPositions: Array.from(board.cursorPositions.entries()),
                            timestamp: board.lastUpdate
                        }));
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        if (boardId && boards.has(boardId)) {
            const board = boards.get(boardId);
            board.users.delete(userId);
            board.cursorPositions.delete(userId);
            broadcastUserList(boardId);
        }
        onlineUsers.delete(userId);
        console.log(`User disconnected: ${userId} (Total users: ${onlineUsers.size})`);
        broadcastOnlineCount();
    });
});

function insertTextAtPosition(text, newText, position) {
    // Ensure position is within bounds
    position = Math.max(0, Math.min(position, text.length));
    return text.slice(0, position) + newText + text.slice(position);
}

function deleteTextAtPosition(text, position) {
    // Ensure position is within bounds and greater than 0
    position = Math.max(1, Math.min(position, text.length));
    return text.slice(0, position - 1) + text.slice(position);
}

function sendInitialState(ws, boardId, userId) {
    if (boards.has(boardId)) {
        const board = boards.get(boardId);
        const users = Array.from(board.users.values()).map(user => ({
            name: user.name,
            color: user.color
        }));
        
        ws.send(JSON.stringify({
            type: 'init',
            paths: board.paths,
            textContent: board.textContent,
            cursorPositions: Array.from(board.cursorPositions.entries()),
            userId: userId,
            users: users,
            timestamp: board.lastUpdate
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
                users: users,
                onlineCount: onlineUsers.size
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

// Error handling for the server
server.on('error', (error) => {
    console.error('Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.log('Port is already in use. Please try a different port.');
        process.exit(1);
    }
});

// Handle process termination
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Closing server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT. Closing server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

// Start the server
server.listen(9000, () => {
    console.log('Server running on http://localhost:9000');
    console.log('Press Ctrl+C to stop the server');
}); 