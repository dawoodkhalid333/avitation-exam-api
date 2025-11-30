const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const { GridFSBucket } = require("mongodb");
const { adminOnly } = require("../middleware/auth");

const storage = multer.memoryStorage();
const upload = multer({ storage });

let bucket;
mongoose.connection.once("open", () => {
  bucket = new GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });
});

// Upload file
router.post("/upload", upload.single("file"), async (req, res) => {
  console.log("media");
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const uploadStream = bucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on("finish", () => {
      res.status(201).json({
        message: "File uploaded successfully",
        fileId: uploadStream.id,
        url: `/api/media/${uploadStream.id}`,
      });
    });

    uploadStream.on("error", (error) => {
      res
        .status(500)
        .json({ message: "Error uploading file", error: error.message });
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error uploading file", error: error.message });
  }
});

// Get file
// (no auth middleware here so GET is public)
router.get("/:id", async (req, res) => {
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.id);

    const files = await bucket.find({ _id: fileId }).toArray();
    if (!files || files.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    res.set("Content-Type", files[0].contentType);
    const downloadStream = bucket.openDownloadStream(fileId);
    downloadStream.pipe(res);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error retrieving file", error: error.message });
  }
});

// Delete file
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.id);
    await bucket.delete(fileId);
    res.json({ message: "File deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting file", error: error.message });
  }
});

module.exports = router;
