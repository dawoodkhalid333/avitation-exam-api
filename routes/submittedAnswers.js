const express = require("express");
const { SubmittedAnswer, ExamSession, Question } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

router.post("/", authenticate, async (req, res) => {
  try {
    const { sessionId, questionId, submittedValue } = req.body;

    if (!sessionId || !questionId || submittedValue === undefined) {
      return res.status(400).json({
        success: false,
        message: "sessionId, questionId, and submittedValue required",
      });
    }

    // Get session with populated data
    const session = await ExamSession.findById(sessionId).populate({
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

    // Check ownership
    const assignment = session.assignmentId;
    if (
      req.user.role === "student" &&
      assignment.studentId.toString() !== req.userId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Prevent submission after exam is fully submitted
    if (session.submittedAt) {
      return res
        .status(400)
        .json({ success: false, message: "Exam already submitted" });
    }

    // Get question
    const question = await Question.findById(questionId).populate("categoryId");
    if (!question) {
      return res
        .status(404)
        .json({ success: false, message: "Question not found" });
    }

    // Check if question belongs to the exam
    const examQuestionIds = assignment.examId.questions.map((q) =>
      q._id.toString()
    );
    if (!examQuestionIds.includes(questionId)) {
      return res
        .status(400)
        .json({ success: false, message: "Question not part of this exam" });
    }

    // Determine correctness
    let isCorrect = false;
    if (question.type === "mcq") {
      isCorrect = String(submittedValue) === String(question.correctAnswer);
    } else {
      // Numerical short answer with tolerance
      const sub = Number(submittedValue);
      const correct = Number(question.correctAnswer);
      const plusT = Number(question.plusT) || 0;
      const minusT = Number(question.minusT) || 0;

      if (!isNaN(sub) && !isNaN(correct)) {
        isCorrect = sub >= correct - minusT && sub <= correct + plusT;
      }
    }

    // Grade change based on correctness
    const gradeChange = isCorrect ? question.marks : 0;

    // Find existing answer
    let answer = await SubmittedAnswer.findOne({ sessionId, questionId });
    let previousGradeContribution = 0;
    if (answer) {
      // === UPDATE EXISTING ANSWER ===
      const previousCorrect = answer.isCorrect;
      previousGradeContribution = previousCorrect ? question.marks : 0;

      // Update fields
      answer.submittedValue = submittedValue;
      answer.isCorrect = isCorrect;
      answer.answeredAt = Date.now(); // optional: update timestamp

      await answer.save();

      // Adjust session grade if correctness changed
      if (previousCorrect && !isCorrect) {
        session.grade -= previousGradeContribution; // was correct → now wrong
      } else if (!previousCorrect && isCorrect) {
        session.grade += gradeChange; // was wrong → now correct
      }
      // if both same (correct→correct or wrong→wrong), no grade change needed
    } else {
      // === CREATE NEW ANSWER ===
      answer = new SubmittedAnswer({
        sessionId,
        questionId,
        submittedValue,
        isCorrect,
      });
      await answer.save();

      session.answeredQuestions.push(answer._id);
      session.grade += gradeChange; // only add when first answered
    }

    // Always update last activity
    session.lastAnsweredAt = new Date();
    await session.save();

    // Populate answer for response
    await answer.populate(["sessionId", "questionId"]);

    // Get answered questions for next logic
    const allAnswers = await SubmittedAnswer.find({ sessionId });
    const answeredQuestionIds = allAnswers.map((a) => a.questionId.toString());

    const questions = assignment.examId.questions;
    const nextQuestionIndex = questions.findIndex(
      (q) => !answeredQuestionIds.includes(q._id.toString())
    );

    const nextQuestion =
      nextQuestionIndex !== -1 ? questions[nextQuestionIndex] : null;
    const isLastQuestion = nextQuestionIndex === -1;

    res.status(answer.isNew ? 201 : 200).json({
      success: true,
      answer,
      isCorrect,
      gradeChange: answer.isNew
        ? gradeChange
        : isCorrect
        ? gradeChange
        : -previousGradeContribution || 0,
      currentGrade: session.grade,
      nextQuestion,
      nextQuestionIndex: isLastQuestion ? null : nextQuestionIndex,
      totalQuestions: questions.length,
      answeredCount: allAnswers.length,
      isLastQuestion,
      examCompleted: isLastQuestion,
      updated: !answer.isNew, // helpful flag for frontend
    });
  } catch (error) {
    console.error("Error submitting answer:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get the last submitted answer for a session (student only - for continuing the exam)
router.get("/session/:sessionId/last", authenticate, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // 1. Find the session and populate everything we need
    const session = await ExamSession.findById(sessionId).populate({
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

    // 2. Ownership check (students can only access their own sessions)
    const assignment = session.assignmentId;
    if (
      req.user.role === "student" &&
      assignment.studentId.toString() !== req.userId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // 3. If the exam is already submitted → no "last" answer to continue with
    if (session.submittedAt) {
      return res
        .status(400)
        .json({ success: false, message: "Exam already submitted" });
    }

    // 4. Find the most recent submitted answer (sorted by createdAt descending)
    const lastAnswer = await SubmittedAnswer.findOne({ sessionId })
      .sort({ createdAt: -1 })
      .populate(["sessionId", "questionId"]);

    if (!lastAnswer) {
      // No answers yet → return info about the first question
      const questions = assignment.examId.questions;
      const nextQuestion = questions[0] || null;

      return res.json({
        success: true,
        answer: null,
        isCorrect: null,
        gradeChange: 0,
        currentGrade: session.grade || 0,
        nextQuestion,
        nextQuestionIndex: 0,
        totalQuestions: questions.length,
        answeredCount: 0,
        isLastQuestion: questions.length === 0,
        examCompleted: false,
      });
    }

    // 5. Re-calculate "next question" logic (same as in POST)
    const allAnswers = await SubmittedAnswer.find({ sessionId });
    const answeredQuestionIds = allAnswers.map((a) =>
      a.questionId._id.toString()
    );

    const questions = assignment.examId.questions;
    const nextQuestionIndex = questions.findIndex(
      (q) => !answeredQuestionIds.includes(q._id.toString())
    );

    let nextQuestion = null;
    let isLastQuestion = false;

    if (nextQuestionIndex !== -1) {
      nextQuestion = questions[nextQuestionIndex];
    } else {
      isLastQuestion = true;
    }

    // 6. Response mirrors the create endpoint exactly
    res.json({
      success: true,
      answer: lastAnswer,
      isCorrect: lastAnswer.isCorrect,
      gradeChange: lastAnswer.isCorrect ? lastAnswer.questionId.marks : 0,
      currentGrade: session.grade,
      nextQuestion,
      nextQuestionIndex: nextQuestionIndex !== -1 ? nextQuestionIndex : null,
      totalQuestions: questions.length,
      answeredCount: allAnswers.length,
      isLastQuestion,
      examCompleted: isLastQuestion,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get submitted answers for a session
// - Admins can always view
// - Students can view only their own session IF review is allowed
router.get(
  "/session/:sessionId",
  authenticate, // must be logged in
  async (req, res) => {
    try {
      const session = await ExamSession.findById(req.params.sessionId).populate(
        {
          path: "assignmentId",
          populate: [{ path: "examId" }, { path: "studentId" }],
        }
      );

      if (!session) {
        return res
          .status(404)
          .json({ success: false, message: "Session not found" });
      }

      // === Permission Check ===
      const isAdmin = req.user.role === "admin";
      const isOwner =
        session.assignmentId.studentId._id.toString() ===
        req.user._id.toString();

      // Students can only access if:
      // 1. It's their own session AND
      // 2. Review is allowed on the assignment
      if (!isAdmin && (!isOwner || !session.assignmentId.isReviewAllowed)) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to review this session.",
        });
      }

      // === Fetch Answers ===
      const answers = await SubmittedAnswer.find({
        sessionId: req.params.sessionId,
      })
        .populate({
          path: "sessionId",
          populate: {
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
          },
        })
        .populate({
          path: "questionId",
          populate: { path: "categoryId" },
        });

      res.json({ success: true, answers });
    } catch (error) {
      console.error("Error fetching session answers:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Get all submitted answers (admin only)
router.get("/", authenticate, adminOnly, async (req, res) => {
  try {
    const answers = await SubmittedAnswer.find()
      .populate({
        path: "sessionId",
        populate: {
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
        },
      })
      .populate({
        path: "questionId",
        populate: { path: "categoryId" },
      });

    res.json({ success: true, answers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
