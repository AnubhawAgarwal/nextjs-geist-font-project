const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

const port = process.env.PORT || 8000;
const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev });
const handle = app.getRequestHandler();

// Game state management
const gameRooms = new Map();
const playerConnections = new Map();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Setup WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected via WebSocket');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('Received message:', data);

        switch (data.type) {
          case 'join_game':
            handleJoinGame(ws, data);
            break;
          case 'chess_move':
            handleChessMove(ws, data);
            break;
          case 'spectate':
            handleSpectate(ws, data);
            break;
          case 'chat_message':
            handleChatMessage(ws, data);
            break;
          default:
            ws.send(JSON.stringify({ error: 'Unknown message type' }));
        }
      } catch (error) {
        console.error('Error processing message:', error);
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
      handleDisconnect(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({ 
      type: 'connected',
      message: 'Welcome to Strength 2 Win Esports Chess Server' 
    }));
  });

  function handleJoinGame(ws, data) {
    const { gameId, playerName } = data;
    
    if (!gameRooms.has(gameId)) {
      gameRooms.set(gameId, {
        players: [],
        spectators: [],
        gameState: initializeChessBoard(),
        currentTurn: 'white',
        moves: []
      });
    }

    const room = gameRooms.get(gameId);
    
    if (room.players.length < 2) {
      const playerColor = room.players.length === 0 ? 'white' : 'black';
      room.players.push({ ws, name: playerName, color: playerColor });
      playerConnections.set(ws, { gameId, role: 'player', color: playerColor });

      // Notify all clients in the room
      broadcastToRoom(gameId, {
        type: 'player_joined',
        player: { name: playerName, color: playerColor },
        gameState: room.gameState,
        currentTurn: room.currentTurn
      });

      if (room.players.length === 2) {
        broadcastToRoom(gameId, {
          type: 'game_start',
          message: 'Game started! White moves first.'
        });
      }
    } else {
      ws.send(JSON.stringify({ error: 'Game room is full' }));
    }
  }

  function handleChessMove(ws, data) {
    const playerInfo = playerConnections.get(ws);
    if (!playerInfo) return;

    const room = gameRooms.get(playerInfo.gameId);
    if (!room) return;

    const { from, to, piece } = data;

    // Basic validation
    if (room.currentTurn !== playerInfo.color) {
      ws.send(JSON.stringify({ error: 'Not your turn' }));
      return;
    }

    // Update game state
    room.gameState[to] = room.gameState[from];
    room.gameState[from] = null;
    room.currentTurn = room.currentTurn === 'white' ? 'black' : 'white';
    room.moves.push({ from, to, piece, player: playerInfo.color });

    // Broadcast move to all clients in the room
    broadcastToRoom(playerInfo.gameId, {
      type: 'move_made',
      move: { from, to, piece, player: playerInfo.color },
      gameState: room.gameState,
      currentTurn: room.currentTurn
    });
  }

  function handleSpectate(ws, data) {
    const { gameId } = data;
    
    if (!gameRooms.has(gameId)) {
      ws.send(JSON.stringify({ error: 'Game not found' }));
      return;
    }

    const room = gameRooms.get(gameId);
    room.spectators.push(ws);
    playerConnections.set(ws, { gameId, role: 'spectator' });

    ws.send(JSON.stringify({
      type: 'spectate_started',
      gameState: room.gameState,
      currentTurn: room.currentTurn,
      moves: room.moves
    }));
  }

  function handleChatMessage(ws, data) {
    const playerInfo = playerConnections.get(ws);
    if (!playerInfo) return;

    broadcastToRoom(playerInfo.gameId, {
      type: 'chat_message',
      message: data.message,
      sender: data.sender || 'Anonymous'
    });
  }

  function handleDisconnect(ws) {
    const playerInfo = playerConnections.get(ws);
    if (!playerInfo) return;

    const room = gameRooms.get(playerInfo.gameId);
    if (!room) return;

    if (playerInfo.role === 'player') {
      room.players = room.players.filter(p => p.ws !== ws);
      broadcastToRoom(playerInfo.gameId, {
        type: 'player_disconnected',
        message: 'A player has disconnected'
      });
    } else if (playerInfo.role === 'spectator') {
      room.spectators = room.spectators.filter(s => s !== ws);
    }

    playerConnections.delete(ws);
  }

  function broadcastToRoom(gameId, message) {
    const room = gameRooms.get(gameId);
    if (!room) return;

    const allClients = [...room.players.map(p => p.ws), ...room.spectators];
    allClients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify(message));
      }
    });
  }

  function initializeChessBoard() {
    const board = {};
    
    // Initialize empty board
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = String.fromCharCode(97 + col) + (row + 1);
        board[square] = null;
      }
    }

    // Set up initial pieces
    const pieces = {
      'a1': '♖', 'b1': '♘', 'c1': '♗', 'd1': '♕', 'e1': '♔', 'f1': '♗', 'g1': '♘', 'h1': '♖',
      'a2': '♙', 'b2': '♙', 'c2': '♙', 'd2': '♙', 'e2': '♙', 'f2': '♙', 'g2': '♙', 'h2': '♙',
      'a8': '♜', 'b8': '♞', 'c8': '♝', 'd8': '♛', 'e8': '♚', 'f8': '♝', 'g8': '♞', 'h8': '♜',
      'a7': '♟', 'b7': '♟', 'c7': '♟', 'd7': '♟', 'e7': '♟', 'f7': '♟', 'g7': '♟', 'h7': '♟'
    };

    Object.assign(board, pieces);
    return board;
  }

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Strength 2 Win Esports Chess Server ready on http://localhost:${port}`);
  });
});
