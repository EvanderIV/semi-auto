// WebSocket connection handling
let socket;
let pingInterval;
let lastPongReceived;
let onPlayerJoined;
let onPlayerLeft;
let onPlayerInfoUpdate;
let onGameStarting;
let onRoomClosed;
let onTapEvent;
let onGameStateUpdate;

function setupSocketEventHandlers() {
    if (!socket) return;

    socket.on('pong', () => {
        lastPongReceived = Date.now();
    });

    socket.on('roomError', (data) => {
        showError(data.message);
    });
    
    socket.on('roomClosed', () => {
        showError('Host has disconnected');
        if (onRoomClosed) {
            onRoomClosed();
        }
    });

    // Add player info update handler
    socket.on('player-info-update', ({ oldName, newName, newSkin }) => {
        if (onPlayerInfoUpdate) {
            onPlayerInfoUpdate(oldName, newName, newSkin);
        }
    });

    // Add game starting handler
    socket.on('gameStarting', () => {
        console.log('Received gameStarting event');
        if (onGameStarting) {
            onGameStarting();
        }
    });

    socket.on('tapEvent', (data) => {
        if (onTapEvent) {
            onTapEvent(data);
        }
    });

    socket.on('gameStateUpdate', (data) => {
        if (onGameStateUpdate) {
            onGameStateUpdate(data);
        }
    });
}

function connectToServer() {
    if (socket && socket.connected) {
        return; // Already connected
    }
    socket = io('https://eminich.com:3434', {
        reconnectionAttempts: 5,
        timeout: 10000,
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        maxRetries: 3,
        pingInterval: 25000,
        pingTimeout: 60000
    });
    
    socket.on('connect', () => {
        console.log('Connected to server');
        lastPongReceived = Date.now();
        
        // Clear any existing ping interval
        if (pingInterval) {
            clearInterval(pingInterval);
        }
        
        // Start ping interval
        pingInterval = setInterval(() => {
            if (socket.connected) {
                socket.emit('ping');
                // Check if we haven't received a pong in 60 seconds
                if (Date.now() - lastPongReceived > 60000) {
                    console.log('Connection lost, attempting to reconnect...');
                    clearInterval(pingInterval);
                    socket.disconnect();
                    setTimeout(() => connectToServer(), 1000);
                }
            }
        }, 25000);

        // Set up event handlers after connection
        setupSocketEventHandlers();
    });
}

function createRoom(roomCode) {
    if (!socket || !socket.connected) {
        connectToServer();
        socket.once('connect', () => {
            performCreateRoom(roomCode);
        });
    } else {
        performCreateRoom(roomCode);
    }
}

function performCreateRoom(roomCode, hostSkin) {
    console.log('Creating room with code:', roomCode);
    
    // Remove any existing listeners first
    socket.off('playerJoined');
    socket.off('playerLeft');
    
    socket.emit('create-room', { 
        roomCode: roomCode,
        hostId: socket.id,
        hostSkin: hostSkin
    });
    
    socket.on('playerJoined', ({ name, skinId, ready }) => {
        console.log('Player joined:', name);
        if (onPlayerJoined) {
            onPlayerJoined(name, skinId, ready);
        }
    });
    
    socket.on('playerLeft', ({ name }) => {
        console.log('Player left:', name);
        if (onPlayerLeft) {
            onPlayerLeft(name);
        }
    });
}

function joinRoom(roomCode, playerName, skinId) {
    if (!socket || !socket.connected) {
        connectToServer();
        
        // Wait for connection before joining
        socket.once('connect', () => {
            performJoin(roomCode, playerName, skinId);
        });
    } else {
        performJoin(roomCode, playerName, skinId);
    }
}

function performJoin(roomCode, playerName, skinId) {
    console.log('Attempting to join room:', roomCode);
    showError('Joining room...');
    
    // Setup updatePlayerInfo handler first
    socket.on('updatePlayerInfo', (data) => {
        console.log('Sending player info update:', data);
    });

    socket.emit('join-room', {
        roomCode: roomCode.toUpperCase(),
        name: playerName,
        skinId: skinId,
        clientId: socket.id
    });

    // Set up handlers for room join process
    socket.once('joinSuccess', (data) => {
        console.log('Successfully joined room:', data);
        document.getElementById('error-message').style.marginTop = "90vmin";
        document.getElementById('error-message').style.color = "#AAFFAA";
        showError('Successfully joined room!');
        // Hide join UI elements
        document.getElementById('game-code').style.display = 'none';
        document.getElementById('join-button').style.display = 'none';
        const root = document.getElementById('root');
        if (root) {
            root.classList.add('game-joined');
        }
    });
    
    socket.once('roomError', (error) => {
        console.error('Room join error:', error);
        document.getElementById('error-message').style.marginTop = "50vmin";
        document.getElementById('error-message').style.color = "#FF0000";
        showError(error.message || 'Failed to join room');
        // Re-enable join UI
        document.getElementById('game-code').style.display = '';
        document.getElementById('join-button').style.display = '';
        document.getElementById('ready-button').style.display = 'none';
        document.getElementById('ready-text').style.display = 'none';
    });
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.opacity = '1';
        }, 10);
        setTimeout(() => {
            errorDiv.style.opacity = '0';
        }, 3000);
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 3500);
    }
}

function sendTap() {
    if (socket && socket.connected) {
        socket.emit('playerTap');
    }
}

function updateGameState(state) {
    if (socket && socket.connected) {
        socket.emit('updateGameState', state);
    }
}

function updatePlayerInfo(data) {
    console.log('NetworkManager: Sending player info update:', data);
    if (socket && socket.connected) {
        socket.emit('updatePlayerInfo', data);
    } else {
        console.error('NetworkManager: Cannot send update - socket not connected');
    }
}

// Export functions and event handlers
window.networkManager = {
    getSocket: () => socket,
    getCallbacks: () => ({
        onPlayerJoined,
        onPlayerLeft,
        onPlayerInfoUpdate,
        onGameStarting,
        onRoomClosed,
        onTapEvent,
        onGameStateUpdate
    }),
    setOnPlayerJoined: (callback) => { onPlayerJoined = callback; },
    setOnPlayerLeft: (callback) => { onPlayerLeft = callback; },
    setOnPlayerInfoUpdate: (callback) => { onPlayerInfoUpdate = callback; },
    setOnGameStarting: (callback) => { onGameStarting = callback; },
    setOnRoomClosed: (callback) => { onRoomClosed = callback; },
    connectToServer,
    createRoom,
    joinRoom,
    updatePlayerInfo,
    setCallbacks: (callbacks) => {
        onPlayerJoined = callbacks.onPlayerJoined;
        onPlayerLeft = callbacks.onPlayerLeft;
        onPlayerInfoUpdate = callbacks.onPlayerInfoUpdate;
        onGameStarting = callbacks.onGameStarting;
        onRoomClosed = callbacks.onRoomClosed;
        onTapEvent = callbacks.onTapEvent;
        onGameStateUpdate = callbacks.onGameStateUpdate;
        setupSocketEventHandlers();
    },
    sendTap,
    updateGameState
};
