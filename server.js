require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("ws"); // <-- WebSocket server
const { ExamSession } = require("./models");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/categories", require("./routes/categories"));
app.use("/api/questions", require("./routes/questions"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/exam-assignments", require("./routes/examAssignments"));
app.use("/api/exam-sessions", require("./routes/examSessions"));
app.use("/api/submitted-answers", require("./routes/submittedAnswers"));
app.use("/api/media", require("./routes/media"));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ===========================
// WebSocket Server Setup
// ===========================
const wss = new Server({ server, path: "/exam-socket" });

wss.on("connection", async (ws, req) => {
  // Parse sessionId from query params: ?sessionId=abc123
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    console.log("Invalid or missing sessionId → closing connection");
    ws.close(1008, "Invalid sessionId");
    return;
  }

  try {
    const session = await ExamSession.findById(sessionId);
    if (!session) {
      ws.close(1008, "Session not found");
      return;
    }

    // Attach session to ws object for later use on disconnect
    ws.examSessionId = sessionId;

    // === ON CONNECT: Start the exam session ===
    const now = new Date().toISOString();

    await ExamSession.findByIdAndUpdate(
      sessionId,
      {
        $set: {
          isRunning: true,
          runAt: now,
          pausedAt: null, // clear previous pause
        },
      },
      { new: true }
    );

    console.log(`Exam session ${sessionId} STARTED at ${now}`);

    // // === 10-SECOND INTERVAL: Update totalTimeConsumed ===
    // const interval = setInterval(async () => {
    //   try {
    //     const currentSession = await ExamSession.findById(sessionId);
    //     if (!currentSession || !currentSession.isRunning) {
    //       clearInterval(interval);
    //       return;
    //     }

    //     const totalTimeConsumed = currentSession.totalTimeConsumed + 10; // add 10 seconds

    //     await ExamSession.findByIdAndUpdate(
    //       sessionId,
    //       {
    //         $set: {
    //           totalTimeConsumed,
    //           // optional: update a "lastSeen" field for monitoring
    //         },
    //       },
    //       { upsert: false }
    //     );
    //   } catch (err) {
    //     console.error("Error in timer interval:", err);
    //   }
    // }, 10_000); // every 10 seconds

    // === ON DISCONNECT ===
    ws.on("close", async () => {
      try {
        const session = await ExamSession.findById(sessionId);
        if (!session) return;

        const now = new Date();
        const runAtTime = session.runAt ? new Date(session.runAt) : now;

        // Time spent in this active run (in seconds)
        const timeInThisRun = Math.floor((now - runAtTime) / 1000);

        // Add to previous consumed time
        const totalTimeConsumed = session.totalTimeConsumed + timeInThisRun;

        await ExamSession.findByIdAndUpdate(sessionId, {
          $set: {
            isRunning: false,
            pausedAt: now.toISOString(),
            totalTimeConsumed,
            // runAt remains the same (for resume logic)
          },
        });

        console.log(
          `Exam session ${sessionId} PAUSED. ` +
            `This run: ${timeInThisRun}s, Total: ${totalTimeConsumed}s`
        );
      } catch (err) {
        console.error("Error on WebSocket disconnect:", err);
      }
    });
  } catch (err) {
    console.error("WebSocket connection error:", err);
    ws.close(1011, "Server error");
  }
});

console.log(
  "WebSocket server running on ws://localhost:" + PORT + "/exam-socket"
);
