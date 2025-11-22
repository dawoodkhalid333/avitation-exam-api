const express = require("express");
const { ExamSession, ExamAssignment, SubmittedAnswer } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

/**
 * Calculates remaining time in seconds for a session
 * Returns:
 *   - null → if exam is untimed
 *   - 0    → if time is up or exam is submitted
 *   - positive number → seconds remaining
 */
const calculateRemainingTime = async (session) => {
  // Ensure assignment and exam are populated
  console.log("start of calculate");
  if (!session.assignmentId || !session.assignmentId.examId) {
    await session.populate({
      path: "assignmentId",
      populate: {
        path: "examId",
        select: "type duration",
      },
    });
  }

  const exam = session.assignmentId.examId;
  // Untimed exam → no time limit
  if (exam.type === "untimed") {
    return null;
  }

  const totalDuration = exam.duration; // in seconds
  const now = Math.floor(Date.now() / 1000);

  // If already submitted → no time left
  if (session.submittedAt) {
    return 0;
  }

  let consumed = 0;

  if (session.resumedAt) {
    // Session is currently active
    consumed = session.timeConsumedBeforeResume + (now - session.resumedAt);
  } else {
    // Session created but never resumed (or paused)
    consumed = session.timeConsumedBeforeResume;
  }

  const remaining = totalDuration - consumed;
  return remaining > 0 ? remaining : 0;
};

/**
 * Attaches remainingTime to one or many sessions
 */
const attachRemainingTime = async (sessionOrSessions) => {
  const sessionsOne = Array.isArray(sessionOrSessions)
    ? sessionOrSessions
    : [sessionOrSessions];

  console.log("for loop starting");
  for (const session of sessionsOne) {
    // if (session && typeof session === "object") {
    //   const plainSession = session.toObject
    //     ? session.toObject()
    //     : { ...session };
    //   plainSession.remainingTime = await calculateRemainingTime(session);
    //   Object.assign(session, plainSession);
    // }
    session.remainingTime = await calculateRemainingTime(session);
  }
  console.log("for loop ended");
  //return Array.isArray(sessionOrSessions) ? sessions : sessions[0];
  const isArrayVar = Array.isArray(sessionOrSessions);

  // console.log("Bool check completed");
  // console.log(Array.isArray(sessionsOne));
  // console.log("Sessions: " + sessionsOne[0]);
  return sessionsOne;
};

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
          { path: "questions", populate: { path: "categoryId" } },
        ],
      },
    });

    const firstQuestion = assignment.examId.questions[0] || null;
    const sessionWithTime = await attachRemainingTime(session);
    // console.log("Session:" + sessionWithTime);

    res.status(201).json({
      success: true,
      session,
      currentQuestion: firstQuestion,
      currentQuestionIndex: 0,
      totalQuestions: assignment.examId.questions.length,
      remainingTime: session.remainingTime,
    });
  } catch (error) {
    console.error("Start session error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Resume exam session
router.post("/resume/:sessionId", authenticate, async (req, res) => {
  try {
    let session = await ExamSession.findById(req.params.sessionId).populate({
      path: "assignmentId",
      populate: {
        path: "examId",
        populate: [
          { path: "categoryId" },
          { path: "questions", populate: { path: "categoryId" } },
        ],
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

    // Already submitted?
    if (session.submittedAt) {
      return res
        .status(400)
        .json({ success: false, message: "Exam already submitted" });
    }

    const submittedAnswers = await SubmittedAnswer.find({
      sessionId: session._id,
    });

    const answeredQuestionIds = submittedAnswers.map((a) =>
      a.questionId.toString()
    );

    const questions = assignment.examId.questions;
    const nextQuestionIndex = questions.findIndex(
      (q) => !answeredQuestionIds.includes(q._id.toString())
    );

    if (nextQuestionIndex === -1) {
      return res
        .status(400)
        .json({ success: false, message: "All questions answered" });
    }

    // Resume timer
    const now = Math.floor(Date.now() / 1000);
    session.resumedAt = now;

    // If first resume, timeConsumedBeforeResume was 0
    // Otherwise it already has accumulated time
    await session.save();

    const sessionWithTime = await attachRemainingTime(session);

    res.json({
      success: true,
      session: sessionWithTime,
      currentQuestion: questions[nextQuestionIndex],
      currentQuestionIndex: nextQuestionIndex,
      totalQuestions: questions.length,
      answeredCount: submittedAnswers.length,
    });
  } catch (error) {
    console.error("Resume session error:", error);
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

    sessions = await attachRemainingTime(sessions);

    res.json({ success: true, sessions });
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single session by ID
router.get("/:id", authenticate, async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.id).populate({
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

    const sessionWithTime = await attachRemainingTime(session);

    res.json({ success: true, session: sessionWithTime });
  } catch (error) {
    console.error("Get session by ID error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
