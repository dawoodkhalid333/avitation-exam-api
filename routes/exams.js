const express = require("express");
const { Exam, ExamAssignment, ExamSession } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");
const { default: mongoose } = require("mongoose");

const router = express.Router();

// Create exam (admin only)
router.post("/", authenticate, adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      categoryId,
      duration,
      questions,
      defaultAttempts,
      defaultExpiry,
      reviewMode,
      opensAt,
      closesAt,
      passingPercentage,
    } = req.body;

    if (
      !name ||
      !type ||
      !categoryId ||
      !duration ||
      !defaultAttempts ||
      !defaultExpiry ||
      !reviewMode ||
      !opensAt ||
      !closesAt ||
      !passingPercentage
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Required fields missing" });
    }

    console.log(opensAt, closesAt);

    // Convert to Date objects
    const opensAtDate = new Date(opensAt);
    const closesAtDate = new Date(closesAt);

    // Validate date conversions
    if (isNaN(opensAtDate.getTime()) || isNaN(closesAtDate.getTime())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid date format" });
    }

    // Validate that closesAt is after opensAt
    if (closesAtDate <= opensAtDate) {
      return res
        .status(400)
        .json({ success: false, message: "closesAt must be after opensAt" });
    }

    const exam = new Exam({
      name,
      description,
      type,
      categoryId,
      duration: duration * 60,
      questions: questions || [],
      defaultAttempts,
      defaultExpiry,
      passingPercentage,
      reviewMode,
      opensAt, // Store as Date object
      closesAt, // Store as Date object
    });

    await exam.save();
    await exam.populate(["categoryId", "questions"]);

    res.status(201).json({ success: true, exam });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all exams
router.get("/", authenticate, async (req, res) => {
  try {
    const exams = await Exam.find().populate(["categoryId", "questions"]);
    res.json({ success: true, exams });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get exam by ID
router.get("/:id", authenticate, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).populate([
      "categoryId",
      "questions",
    ]);
    if (!exam) {
      return res
        .status(404)
        .json({ success: false, message: "Exam not found" });
    }
    res.json({ success: true, exam });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update exam (admin only)
router.put("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      categoryId,
      duration,
      questions,
      defaultAttempts,
      defaultExpiry,
      passingPercentage,
      reviewMode,
      opensAt,
      closesAt,
    } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (type) updateData.type = type;
    if (categoryId) updateData.categoryId = categoryId;
    if (duration !== undefined) updateData.duration = duration;
    if (questions !== undefined) updateData.questions = questions;
    if (defaultAttempts !== undefined)
      updateData.defaultAttempts = defaultAttempts;
    if (defaultExpiry !== undefined) updateData.defaultExpiry = defaultExpiry;
    if (reviewMode) updateData.reviewMode = reviewMode;
    if (opensAt !== undefined) updateData.opensAt = opensAt;
    if (closesAt !== undefined) updateData.closesAt = closesAt;
    if (passingPercentage !== undefined)
      updateData.passingPercentage = passingPercentage;

    const exam = await Exam.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).populate(["categoryId", "questions"]);

    if (!exam) {
      return res
        .status(404)
        .json({ success: false, message: "Exam not found" });
    }

    res.json({ success: true, exam });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete exam (admin only)
router.delete("/:id", authenticate, adminOnly, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const examId = req.params.id;

    // Check if exam exists
    const exam = await Exam.findById(examId);
    if (!exam) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Exam not found" });
    }

    // First, find all assignments for this exam
    const assignments = await ExamAssignment.find(
      { examId },
      { _id: 1 },
      { session }
    );
    const assignmentIds = assignments.map((assignment) => assignment._id);

    // Delete all related data in transaction
    await Promise.all([
      // Delete all exam sessions that reference these assignments
      ExamSession.deleteMany(
        {
          assignmentId: { $in: assignmentIds },
        },
        { session }
      ),

      // Delete all exam assignments for this exam
      ExamAssignment.deleteMany({ examId }, { session }),
    ]);

    // Finally delete the exam itself
    await Exam.findByIdAndDelete(examId, { session });

    // Commit the transaction
    await session.commitTransaction();

    res.json({
      success: true,
      message:
        "Exam and all related assignments and sessions deleted successfully",
    });
  } catch (error) {
    // Rollback any changes made in the transaction
    await session.abortTransaction();
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // End the session
    session.endSession();
  }
});

module.exports = router;
