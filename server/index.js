const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const waitingQueue = [];
const pairs = {};
const gameState = {};
const storyState = {}; // roomKey -> { sentences: [], currentTurn: socketId }

const questions = [
  { a: "Pizza", b: "Tacos" },
  { a: "Mountains", b: "Beach" },
  { a: "Dogs", b: "Cats" },
  { a: "Morning person", b: "Night owl" },
  { a: "Summer", b: "Winter" },
  { a: "Movies", b: "TV Shows" },
  { a: "Coffee", b: "Tea" },
  { a: "City life", b: "Country life" },
  { a: "Reading", b: "Watching" },
  { a: "Introvert", b: "Extrovert" },
  { a: "Fast food", b: "Home cooked" },
  { a: "Sneakers", b: "Sandals" },
  { a: "Texting", b: "Calling" },
  { a: "Sweet", b: "Salty" },
  { a: "Cats", b: "Dogs" },
  { a: "Early bird", b: "Sleeping in" },
  { a: "Netflix", b: "YouTube" },
  { a: "Traveling", b: "Staying home" },
  { a: "Android", b: "iPhone" },
  { a: "Spicy food", b: "Mild food" },
  { a: "Gym", b: "Outdoor workout" },
  { a: "Music", b: "Podcasts" },
  { a: "Chocolate", b: "Vanilla" },
  { a: "Sunrise", b: "Sunset" },
  { a: "Car", b: "Motorcycle" },
];

app.get("/", (req, res) => {
  res.send("Stranger Chat Server is running.");
});

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  function tryPair() {
    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      const partner = io.sockets.sockets.get(partnerId);
      if (!partner) { tryPair(); return; }

      pairs[socket.id] = partnerId;
      pairs[partnerId] = socket.id;

      socket.emit("paired");
      partner.emit("paired");
    } else {
      waitingQueue.push(socket.id);
      socket.emit("waiting");
    }
  }

  socket.on("find_partner", () => {
    const oldPartnerId = pairs[socket.id];
    if (oldPartnerId) {
      const oldPartner = io.sockets.sockets.get(oldPartnerId);
      if (oldPartner) oldPartner.emit("partner_left");
      // clean up game/story state
      const oldKey = [socket.id, oldPartnerId].sort().join("_");
      delete gameState[oldKey];
      delete storyState[oldKey];
      delete pairs[oldPartnerId];
      delete pairs[socket.id];
    }
    const qIdx = waitingQueue.indexOf(socket.id);
    if (qIdx !== -1) waitingQueue.splice(qIdx, 1);
    tryPair();
  });

  socket.on("message", (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("message", { text: data.text });
    }
  });

  // This or That game
  socket.on("this_or_that_start", () => {
    const partnerId = pairs[socket.id];
    if (!partnerId) return;

    const question = questions[Math.floor(Math.random() * questions.length)];
    const roomKey = [socket.id, partnerId].sort().join("_");
    gameState[roomKey] = { question, answers: {} };

    io.to(socket.id).emit("this_or_that_question", question);
    io.to(partnerId).emit("this_or_that_question", question);
  });

  socket.on("this_or_that_answer", ({ choice }) => {
    const partnerId = pairs[socket.id];
    if (!partnerId) return;

    const roomKey = [socket.id, partnerId].sort().join("_");
    if (!gameState[roomKey]) return;

    gameState[roomKey].answers[socket.id] = choice;
    const partnerAnswer = gameState[roomKey].answers[partnerId];

    if (partnerAnswer !== undefined) {
      const matched = choice === partnerAnswer;
      io.to(socket.id).emit("this_or_that_reveal", {
        yourChoice: choice,
        strangerChoice: partnerAnswer,
        matched,
      });
      io.to(partnerId).emit("this_or_that_reveal", {
        yourChoice: partnerAnswer,
        strangerChoice: choice,
        matched,
      });
      delete gameState[roomKey];
    } else {
      socket.emit("this_or_that_waiting");
    }
  });

  // Collaborative Story
  socket.on("story_start", () => {
    const partnerId = pairs[socket.id];
    if (!partnerId) return;

    const roomKey = [socket.id, partnerId].sort().join("_");
    storyState[roomKey] = { sentences: [], currentTurn: socket.id };

    socket.emit("story_started", { yourTurn: true, sentences: [] });
    io.to(partnerId).emit("story_started", { yourTurn: false, sentences: [] });
  });

  socket.on("story_add", ({ sentence }) => {
    const partnerId = pairs[socket.id];
    if (!partnerId) return;

    const roomKey = [socket.id, partnerId].sort().join("_");
    const story = storyState[roomKey];
    if (!story || story.currentTurn !== socket.id) return;

    const trimmed = sentence.trim();
    if (!trimmed) return;

    story.sentences.push({ text: trimmed, author: "you" });
    story.currentTurn = partnerId;

    socket.emit("story_updated", { sentences: story.sentences, yourTurn: false });
    io.to(partnerId).emit("story_updated", {
      sentences: story.sentences.map((s) => ({
        ...s,
        author: s.author === "you" ? "stranger" : "you",
      })),
      yourTurn: true,
    });
  });

  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);
    const qIdx = waitingQueue.indexOf(socket.id);
    if (qIdx !== -1) waitingQueue.splice(qIdx, 1);

    const partnerId = pairs[socket.id];
    if (partnerId) {
      const partner = io.sockets.sockets.get(partnerId);
      if (partner) partner.emit("partner_left");
      const roomKey = [socket.id, partnerId].sort().join("_");
      delete gameState[roomKey];
      delete storyState[roomKey];
      delete pairs[partnerId];
    }
    delete pairs[socket.id];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
