require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { User } = require("./models");

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const hashedPassword = await bcrypt.hash("admin123", 10);
  const admin = new User({
    name: "Admin User",
    role: "admin",
    email: "admin@example.com",
    hashedPassword,
  });
  await admin.save();
  console.log("Admin created:", admin);
  process.exit(0);
});
