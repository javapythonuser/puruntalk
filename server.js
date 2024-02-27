// server.js 수정
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const he = require('he');
const sanitizeHtml = require('sanitize-html');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const users = {};
const waitingUsers = [];

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 관리자 페이지 경로 설정
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin.html'); // 관리자 페이지 HTML 파일 경로
});

// 관리자용 네임스페이스 설정
const adminNamespace = io.of('/admin');
adminNamespace.on('connection', (socket) => {
  console.log('Admin connected');

  socket.on('requestUsersInfo', () => {
    // 대기 중인 사용자 목록
    const waitingUserNicknames = waitingUsers.map(userId => users[userId].nickname);

    // 대화 중인 사용자 목록
    const chattingPairs = [];
    const usedIds = new Set(); // 이미 처리한 사용자 ID를 추적
    for (let userId in users) {
      if (users[userId].partner && !usedIds.has(userId)) {
        chattingPairs.push({
          user1: users[userId].nickname,
          user2: users[users[userId].partner].nickname
        });
        usedIds.add(userId);
        usedIds.add(users[userId].partner);
      }
    }

    // 정보 전송
    socket.emit('usersInfo', {
      waitingUserNicknames,
      chattingPairs,
      waitingCount: waitingUserNicknames.length,
      chattingCount: chattingPairs.length
    });
  });
});

io.on('connection', (socket) => {
  socket.on('setNickname', (nickname) => {
    users[socket.id] = { nickname, socket };
    addToWaitingList(socket.id);
  });

  socket.on('disconnect', () => {
    removeUser(socket.id);
  });

  socket.on('findNew', () => {
    moveToWaitingList(socket.id);
  });

  socket.on('message', (msg) => {
    sendMessage(socket.id, msg);
  });
});

function addToWaitingList(userId) {
  waitingUsers.push(userId);
  checkPairing();
}

function removeUser(userId) {
  const partnerId = users[userId]?.partner;
  if (partnerId) {
    // 사용자의 대화 상대에게 partnerDisconnected 이벤트 전송
    users[partnerId].socket.emit('partnerDisconnected');
    // 대화 상대의 partner 정보 제거
    delete users[partnerId].partner;
  }
  delete users[userId];
  const index = waitingUsers.indexOf(userId);
  if (index !== -1) waitingUsers.splice(index, 1);
}

function moveToWaitingList(userId) {
  // 기존 대화 상대와의 연결 해제
  const partnerId = users[userId].partner;
  if (partnerId) {
    users[partnerId].socket.emit('partnerDisconnected');
    delete users[partnerId].partner;
  }
  delete users[userId].partner;
  
  // 대기열에 다시 추가
  addToWaitingList(userId);
}

function checkPairing() {
  while (waitingUsers.length >= 2) {
    const user1Id = waitingUsers.shift();
    const user2Id = waitingUsers.shift();
    startChat(user1Id, user2Id);
  }
}

function startChat(user1Id, user2Id) {
  users[user1Id].partner = user2Id;
  users[user2Id].partner = user1Id;
  users[user1Id].socket.emit('chatStart', { with: users[user2Id].nickname });
  users[user2Id].socket.emit('chatStart', { with: users[user1Id].nickname });
}

function sendMessage(senderId, msg) {
  // HTML 엔티티 디코딩
  const decodedMessage = he.decode(msg);

  // 디코드된 메시지 필터링
  const sanitizedMessage = sanitizeHtml(decodedMessage, {
    allowedTags: [],
    allowedAttributes: {}
  });

  const receiverId = users[senderId].partner;
  if (receiverId) {
    users[receiverId].socket.emit('message', { from: users[senderId].nickname, msg: sanitizedMessage });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
