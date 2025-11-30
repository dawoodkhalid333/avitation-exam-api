const express = require("express");
const { ExamAssignment, Exam, ExamSession } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

// Bulk create assignments (admin only)
router.post("/bulk", authenticate, adminOnly, async (req, res) => {
  try {
    const {
      examId,
      studentIds,
      allowedAttempts,
      opensAt,
      closesAt,
      isReviewAllowed,
      bulkAssignmentId,
    } = req.body;
    if (
      !examId ||
      !studentIds ||
      !Array.isArray(studentIds) ||
      studentIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "examId and studentIds array required",
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res
        .status(404)
        .json({ success: false, message: "Exam not found" });
    }

    const bulkId = bulkAssignmentId || `bulk_${Date.now()}`;
    const assignments = [];

    for (const studentId of studentIds) {
      const assignment = new ExamAssignment({
        examId,
        studentId,
        allowedAttempts: allowedAttempts || exam.defaultAttempts,
        opensAt: opensAt || exam.opensAt,
        closesAt: closesAt || exam.closesAt,
        isReviewAllowed: isReviewAllowed || exam.reviewMode === "practice",
        bulkAssignmentId: bulkId,
        status: "active",
        attemptsUsed: 0,
      });

      await assignment.save();
      await assignment.populate(["examId", "studentId"]);
      assignments.push(assignment);
    }

    res
      .status(201)
      .json({ success: true, assignments, bulkAssignmentId: bulkId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all assignments (filtered by role)
router.get("/", authenticate, async (req, res) => {
  try {
    let query = {};

    if (req.user.role === "student") {
      query.studentId = req.userId;
    }

    const assignments = await ExamAssignment.find(query)
      .populate({
        path: "examId",
        populate: [{ path: "categoryId" }, { path: "questions" }],
      })
      .populate("studentId");

    const assignmentIds = assignments?.map((ass) => ass._id);
    const sessionToResume = await ExamSession.findOne({
      assignmentId: { $in: assignmentIds },
      submittedAt: null,
    });

    // Attach sessionToResume to the matching assignment
    const assignmentsWithSession = assignments.map((assignment) => {
      // Convert both IDs to string for comparison
      const hasSession =
        sessionToResume &&
        sessionToResume.assignmentId.toString() === assignment._id.toString();

      return {
        ...assignment.toObject(),
        sessionToResume: hasSession ? sessionToResume : null,
      };
    });

    res.json({ success: true, assignments: assignmentsWithSession });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get assignment by ID
router.get("/:id", authenticate, async (req, res) => {
  try {
    const assignment = await ExamAssignment.findById(req.params.id)
      .populate({
        path: "examId",
        populate: [{ path: "categoryId" }, { path: "questions" }],
      })
      .populate("studentId");

    if (!assignment) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found" });
    }

    // Students can only see their own assignments
    if (
      req.user.role === "student" &&
      assignment.studentId._id.toString() !== req.userId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, assignment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update assignment (admin only)
router.put("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const { allowedAttempts, opensAt, closesAt, status, isReviewAllowed } =
      req.body;

    const updateData = {};
    if (allowedAttempts !== undefined)
      updateData.allowedAttempts = allowedAttempts;
    if (opensAt !== undefined) updateData.opensAt = opensAt;
    if (closesAt !== undefined) updateData.closesAt = closesAt;
    if (status) updateData.status = status;
    if (isReviewAllowed !== undefined)
      updateData.isReviewAllowed = isReviewAllowed;

    const assignment = await ExamAssignment.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    )
      .populate({
        path: "examId",
        populate: [{ path: "categoryId" }, { path: "questions" }],
      })
      .populate("studentId");

    if (!assignment) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found" });
    }

    res.json({ success: true, assignment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete assignment (admin only)
router.delete("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const assignment = await ExamAssignment.findByIdAndDelete(req.params.id);
    if (!assignment) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found" });
    }
    res.json({ success: true, message: "Assignment deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
