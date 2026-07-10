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

// waiting queue and active pairs
const waitingQueue = [];
const pairs = {}; // socketId -> partnerSocketId

app.get("/", (req, res) => {
  res.send("Stranger Chat Server is running.");
});

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Try to pair with someone in the queue
  function tryPair() {
    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      const partner = io.sockets.sockets.get(partnerId);

      if (!partner) {
        // Partner disconnected while waiting, try again
        tryPair();
        return;
      }

      pairs[socket.id] = partnerId;
      pairs[partnerId] = socket.id;

      socket.emit("paired", { message: "You are now chatting with a stranger!" });
      partner.emit("paired", { message: "You are now chatting with a stranger!" });
    } else {
      waitingQueue.push(socket.id);
      socket.emit("waiting", { message: "Looking for a stranger..." });
    }
  }

  // User wants to find a chat partner
  socket.on("find_partner", () => {
    // Clean up any existing pair
    const oldPartnerId = pairs[socket.id];
    if (oldPartnerId) {
      const oldPartner = io.sockets.sockets.get(oldPartnerId);
      if (oldPartner) {
        oldPartner.emit("partner_left", { message: "Stranger has disconnected." });
      }
      delete pairs[oldPartnerId];
      delete pairs[socket.id];
    }

    // Remove from queue if already there
    const qIdx = waitingQueue.indexOf(socket.id);
    if (qIdx !== -1) waitingQueue.splice(qIdx, 1);

    tryPair();
  });

  // Relay message to partner
  socket.on("message", (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("message", {
        text: data.text,
        from: "stranger",
      });
    }
  });

  // User clicks "Next" / disconnects
  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);

    // Remove from waiting queue
    const qIdx = waitingQueue.indexOf(socket.id);
    if (qIdx !== -1) waitingQueue.splice(qIdx, 1);

    // Notify partner
    const partnerId = pairs[socket.id];
    if (partnerId) {
      const partner = io.sockets.sockets.get(partnerId);
      if (partner) {
        partner.emit("partner_left", { message: "Stranger has disconnected." });
      }
      delete pairs[partnerId];
    }
    delete pairs[socket.id];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
