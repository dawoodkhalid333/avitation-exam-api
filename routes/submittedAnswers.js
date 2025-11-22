const express = require("express");
const { SubmittedAnswer, ExamSession, Question } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

// Create submitted answer
router.post("/", authenticate, async (req, res) => {
  try {
    const { sessionId, questionId, submittedValue } = req.body;

    if (!sessionId || !questionId || submittedValue === undefined) {
      return res.status(400).json({
        success: false,
        message: "sessionId, questionId, and submittedValue required",
      });
    }

    // Get session
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

    // Check if already submitted
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

    // Check if question is part of the exam
    const examQuestionIds = assignment.examId.questions.map((q) =>
      q._id.toString()
    );
    if (!examQuestionIds.includes(questionId)) {
      return res
        .status(400)
        .json({ success: false, message: "Question not part of this exam" });
    }

    // Check if already answered
    const existingAnswer = await SubmittedAnswer.findOne({
      sessionId,
      questionId,
    });
    if (existingAnswer) {
      return res
        .status(400)
        .json({ success: false, message: "Question already answered" });
    }

    // Determine if answer is correct
    let isCorrect = false;
    if (question.type === "mcq") {
      isCorrect = String(submittedValue) === String(question.correctAnswer);
    } else {
      // For short answers, do tolerance-sensitive comparison
      isCorrect = (function () {
        const sub = Number(submittedValue);
        const correct = Number(question.correctAnswer);
        const plusT = Number(question.plusT) || 0;
        const minusT = Number(question.minusT) || 0;

        return sub >= correct - minusT && sub <= correct + plusT;
      })();
    }

    // Create submitted answer
    const answer = new SubmittedAnswer({
      sessionId,
      questionId,
      submittedValue,
      isCorrect,
    });

    await answer.save();
    await answer.populate(["sessionId", "questionId"]);

    // Update session grade
    let gradeChange = 0;
    if (isCorrect) {
      gradeChange = question.marks; // Award full marks for correct answers
    } else {
      gradeChange = 0; // No marks for incorrect answers (or use a fixed penalty)
    }

    session.grade += gradeChange;
    await session.save();

    // Get all submitted answers to find next question
    const allAnswers = await SubmittedAnswer.find({ sessionId });
    const answeredQuestionIds = allAnswers.map((a) => a.questionId.toString());

    // Find next question
    const questions = assignment.examId.questions;
    const nextQuestionIndex = questions.findIndex(
      (q) => !answeredQuestionIds.includes(q._id.toString())
    );

    let nextQuestion = null;
    let isLastQuestion = false;

    if (nextQuestionIndex !== -1) {
      nextQuestion = questions[nextQuestionIndex];
    } else {
      // All questions answered - mark session as submitted
      isLastQuestion = true;
      session.submittedAt = Math.floor(Date.now() / 1000);
      await session.save();
    }

    res.status(201).json({
      success: true,
      answer,
      isCorrect,
      gradeChange,
      currentGrade: session.grade,
      nextQuestion,
      nextQuestionIndex: nextQuestionIndex !== -1 ? nextQuestionIndex : null,
      totalQuestions: questions.length,
      answeredCount: allAnswers.length,
      isLastQuestion,
      examCompleted: isLastQuestion,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get submitted answers by session ID (admin only)
router.get("/session/:sessionId", authenticate, adminOnly, async (req, res) => {
  try {
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
    res.status(500).json({ success: false, message: error.message });
  }
});

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
