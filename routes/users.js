const express = require("express");
const bcrypt = require("bcryptjs");
const { User } = require("../models");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

// Create user (admin only)
router.post("/", authenticate, adminOnly, async (req, res) => {
  try {
    const { name, role, email, password } = req.body;

    if (!name || !role || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "All fields required" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      role,
      email: email.toLowerCase(),
      hashedPassword,
    });

    await user.save();

    res.status(201).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all users (admin only)
router.get("/", authenticate, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select("-hashedPassword");
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get user by ID (admin only)
router.get("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-hashedPassword");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update user (admin only)
router.put("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const { name, role, email, password } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (email) updateData.email = email.toLowerCase();
    if (password) updateData.hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).select("-hashedPassword");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete user (admin only)
router.delete("/:id", authenticate, adminOnly, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
