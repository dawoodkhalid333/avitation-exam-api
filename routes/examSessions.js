const express = require("express");
const { ExamSession, ExamAssignment, SubmittedAnswer } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

// Start exam session
router.post("/start", authenticate, async (req, res) => {
  try {
    const { assignmentId } = req.body;
    if (!assignmentId) {
      return res
        .status(400)
        .json({ success: false, message: "assignmentId is required" });
    }

    const assignment = await ExamAssignment.findById(assignmentId)
      .populate({
        path: "examId",
        populate: [
          { path: "categoryId" },
          { path: "questions", populate: { path: "categoryId" } },
        ],
      })
      .populate("studentId");

    if (!assignment) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found" });
    }

    // Check ownership
    if (
      req.user.role === "student" &&
      assignment.studentId?._id?.toString() !== req.userId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Check status & attempts
    if (assignment.status !== "active") {
      return res
        .status(400)
        .json({ success: false, message: "Assignment is not active" });
    }
    if (assignment.attemptsUsed >= assignment.allowedAttempts) {
      return res
        .status(400)
        .json({ success: false, message: "No attempts remaining" });
    }

    // Check time window
    const now = Math.floor(Date.now() / 1000);
    if (now < assignment.opensAt || now > assignment.closesAt) {
      return res
        .status(400)
        .json({ success: false, message: "Exam not available at this time" });
    }

    // Check for existing unsubmitted session
    const existing = await ExamSession.findOne({
      assignmentId,
      submittedAt: null,
    });

    if (existing) {
      return res.json({
        success: true,
        session: { id: existing._id },
      });
    }

    // Create new session
    const session = new ExamSession({
      assignmentId,
      grade: 0,
      submittedAt: null,
    });

    await session.save();
    await assignment.save();

    // Populate session fully
    await session.populate({
      path: "assignmentId",
      populate: {
        path: "examId",
        populate: [
          { path: "categoryId" },
          // { path: "questions", populate: { path: "categoryId" } },
        ],
      },
    });

    res.status(201).json({
      success: true,
      session: { id: session._id },
    });
  } catch (error) {
    console.error("Start session error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all sessions (admin sees all, student sees own)
router.get("/", authenticate, async (req, res) => {
  try {
    let sessions;

    if (req.user.role === "admin") {
      sessions = await ExamSession.find().populate({
        path: "assignmentId",
        populate: [
          {
            path: "examId",
            populate: [
              { path: "categoryId" },
              { path: "questions", populate: { path: "categoryId" } },
            ],
          },
          { path: "studentId" },
        ],
      });
    } else {
      const assignments = await ExamAssignment.find({ studentId: req.userId });
      const assignmentIds = assignments.map((a) => a._id);

      sessions = await ExamSession.find({
        assignmentId: { $in: assignmentIds },
      }).populate({
        path: "assignmentId",
        populate: [
          {
            path: "examId",
            populate: [
              { path: "categoryId" },
              { path: "questions", populate: { path: "categoryId" } },
            ],
          },
          { path: "studentId" },
        ],
      });
    }

    res.json({ success: true, sessions });
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single session by ID
router.get("/:id", authenticate, async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.id)
      .populate({
        path: "assignmentId",
        populate: [
          {
            path: "examId",
            populate: [
              { path: "categoryId" },
              { path: "questions", populate: { path: "categoryId" } },
            ],
          },
          { path: "studentId" },
        ],
      })
      .populate("answeredQuestions")
      .populate("bookmarkedQuestions");

    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    }

    // Check ownership
    if (
      req.user.role === "student" &&
      session.assignmentId.studentId._id.toString() !== req.userId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, session });
  } catch (error) {
    console.error("Get session by ID error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get remaining time for a session
router.get("/remaining-time/:sessionId", authenticate, async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId).populate({
      path: "assignmentId",
      populate: {
        path: "examId",
        select: "type duration",
      },
    });

    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    }

    const assignment = session.assignmentId;

    // Check ownership
    if (
      req.user.role === "student" &&
      assignment.studentId.toString() !== req.userId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const exam = assignment.examId;

    // Untimed exam → no time limit
    if (exam.type === "untimed") {
      return res.json({
        success: true,
        remainingTime: null,
        type: "untimed",
      });
    }

    // If already submitted → no time left
    if (session.submittedAt) {
      return res.json({
        success: true,
        remainingTime: 0,
        type: "submitted",
      });
    }

    const duration = exam.duration; // in seconds
    let timeConsumed = session.totalTimeConsumed || 0;

    const remainingTime = duration - timeConsumed;

    res.json({
      success: true,
      remainingTime: remainingTime > 0 ? Math.floor(remainingTime) : 0,
      type: "timed",
    });
  } catch (error) {
    console.error("Get remaining time error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add a question to answeredQuestions array (idempotent)
router.post(
  "/:sessionId/answered/:questionId",
  authenticate,
  async (req, res) => {
    try {
      const { sessionId, questionId } = req.params;

      const session = await ExamSession.findById(sessionId).populate({
        path: "assignmentId",
        populate: { path: "studentId examId", populate: { path: "questions" } },
      });

      if (!session) {
        return res
          .status(404)
          .json({ success: false, message: "Session not found" });
      }

      // Ownership check
      if (
        req.user.role === "student" &&
        session.assignmentId.studentId._id.toString() !== req.userId
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied" });
      }

      // Prevent action if already submitted
      if (session.submittedAt) {
        return res
          .status(400)
          .json({ success: false, message: "Exam already submitted" });
      }

      // Validate that the question belongs to this exam
      const questionExists = session.assignmentId.examId.questions.some(
        (q) => q._id.toString() === questionId
      );
      if (!questionExists) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid question for this exam" });
      }

      // Add if not already present (idempotent)
      if (!session.answeredQuestions.includes(questionId)) {
        session.answeredQuestions.push(questionId);
        await session.save();
      }

      res.json({
        success: true,
        message: "Question marked as answered",
        answeredQuestions: session.answeredQuestions,
      });
    } catch (error) {
      console.error("Add answered question error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Toggle bookmark for a question (add or remove)
router.post(
  "/:sessionId/bookmark/:questionId",
  authenticate,
  async (req, res) => {
    try {
      const { sessionId, questionId } = req.params;

      const session = await ExamSession.findById(sessionId)
        .populate({
          path: "assignmentId",
          populate: [{ path: "studentId" }, { path: "examId" }],
        })
        .populate({
          path: "assignmentId.examId",
          populate: { path: "questions" },
        });

      if (!session) {
        return res
          .status(404)
          .json({ success: false, message: "Session not found" });
      }

      // Ownership check
      if (
        req.user.role === "student" &&
        session.assignmentId.studentId._id.toString() !== req.userId
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied" });
      }

      // Prevent action if already submitted (optional — you might allow viewing bookmarks after submit)
      if (session.submittedAt) {
        return res
          .status(400)
          .json({ success: false, message: "Exam already submitted" });
      }

      // Validate question belongs to exam
      const questionExists = session.assignmentId.examId.questions.some(
        (q) => q._id.toString() === questionId
      );
      if (!questionExists) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid question for this exam" });
      }

      const bookmarkIndex = session.bookmarkedQuestions.findIndex(
        (id) => id.toString() === questionId
      );

      if (bookmarkIndex === -1) {
        // Add bookmark
        session.bookmarkedQuestions.push(questionId);
        await session.save();
        return res.json({
          success: true,
          action: "bookmarked",
          bookmarkedQuestions: session.bookmarkedQuestions,
        });
      } else {
        // Remove bookmark
        session.bookmarkedQuestions.splice(bookmarkIndex, 1);
        await session.save();
        return res.json({
          success: true,
          action: "unbookmarked",
          bookmarkedQuestions: session.bookmarkedQuestions,
        });
      }
    } catch (error) {
      console.error("Toggle bookmark error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Submit exam session - simply mark as submitted
router.post("/:sessionId/submit", authenticate, async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId).populate({
      path: "assignmentId",
      populate: { path: "studentId" },
    });

    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    }

    // Ownership check
    if (
      req.user.role === "student" &&
      session.assignmentId.studentId._id.toString() !== req.userId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Prevent double submission
    if (session.submittedAt) {
      return res
        .status(400)
        .json({ success: false, message: "Exam already submitted" });
    }

    // Mark as submitted with current ISO timestamp
    session.submittedAt = new Date().toISOString();

    // Stop any running timer state
    session.isRunning = false;
    session.runAt = null;
    session.pausedAt = null;

    await session.save();

    // Increment attempts used on assignment
    const assignment = session.assignmentId;
    assignment.attemptsUsed += 1;

    await assignment.save();

    res.json({
      success: true,
      message: "Exam submitted successfully",
      submittedAt: session.submittedAt,
    });
  } catch (error) {
    console.error("Submit exam error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
