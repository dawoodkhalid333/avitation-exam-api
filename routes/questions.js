const express = require("express");
const { Question, Exam } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

// Create question (admin only)
router.post("/", authenticate, adminOnly, async (req, res) => {
  try {
    const {
      text,
      categoryId,
      type,
      marks,
      unit,
      difficulty,
      feedback,
      correctAnswer,
      plusT,
      minusT,
      options,
      optionsWithImgs,
    } = req.body;

    if (
      !text ||
      !categoryId ||
      !type ||
      !marks ||
      !difficulty ||
      !correctAnswer
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Required fields missing" });
    }

    const question = new Question({
      text,
      categoryId,
      type,
      marks,
      unit,
      difficulty,
      feedback: feedback || null,
      correctAnswer,
      plusT,
      minusT,
      options,
      optionsWithImgs,
    });

    await question.save();
    await question.populate("categoryId");

    res.status(201).json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all questions (admin only)
router.get("/", authenticate, adminOnly, async (req, res) => {
  try {
    const questions = await Question.find().populate("categoryId");
    res.json({ success: true, questions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get question by ID (admin only)
router.get("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const question = await Question.findById(req.params.id).populate(
      "categoryId"
    );
    if (!question) {
      return res
        .status(404)
        .json({ success: false, message: "Question not found" });
    }
    res.json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update question (admin only)
router.put("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const {
      text,
      categoryId,
      type,
      marks,
      difficulty,
      feedback,
      correctAnswer,
      plusT,
      minusT,
      options,
    } = req.body;

    const updateData = {};
    if (text) updateData.text = text;
    if (categoryId) updateData.categoryId = categoryId;
    if (type) updateData.type = type;
    if (marks !== undefined) updateData.marks = marks;
    if (difficulty) updateData.difficulty = difficulty;
    if (feedback !== undefined) updateData.feedback = feedback;
    if (correctAnswer !== undefined)
      updateData.correctAnswer =
        correctAnswer?.mcq?.[0] || correctAnswer?.short?.value;
    if (plusT !== undefined) updateData.plusT = plusT;
    if (minusT !== undefined) updateData.minusT = minusT;
    if (options !== undefined) updateData.options = options;

    const question = await Question.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate("categoryId");

    if (!question) {
      return res
        .status(404)
        .json({ success: false, message: "Question not found" });
    }

    res.json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete question (admin only)
router.delete("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const examsCount = await Exam.countDocuments({
      questions: req.params.id,
    });
    if (examsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete question associated with exams: ${examsCount} exam(s) found.`,
      });
    }
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      return res
        .status(404)
        .json({ success: false, message: "Question not found" });
    }
    res.json({ success: true, message: "Question deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
