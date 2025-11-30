const mongoose = require("mongoose");

// Plugin: expose id instead of _id
const idPlugin = (schema) => {
  const transform = (doc, ret) => {
    ret.id = ret?._id?.toString();
    delete ret?._id;
    delete ret.__v;
    return ret;
  };

  schema.set("toJSON", { virtuals: true, transform });
  schema.set("toObject", { virtuals: true, transform });
};

// User Model
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: { type: String, enum: ["admin", "student"], required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    hashedPassword: { type: String, required: true },
  },
  { timestamps: true }
);
userSchema.plugin(idPlugin);
const User = mongoose.model("User", userSchema);

// Category Model
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);
categorySchema.plugin(idPlugin);
const Category = mongoose.model("Category", categorySchema);

// Question Model
const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    type: { type: String, enum: ["mcq", "short"], required: true },
    marks: { type: Number, required: true },
    unit: { type: String, default: null },
    difficulty: {
      type: String,
      enum: ["hard", "medium", "easy"],
      required: true,
    },
    feedback: { type: String, default: null },
    correctAnswer: { type: mongoose.Schema.Types.Mixed, required: true },
    plusT: { type: Number },
    minusT: { type: Number },
    options: [{ type: mongoose.Schema.Types.Mixed }],
    optionsWithImgs: [
      {
        option: { type: String },
        img: { type: String },
      },
    ],
    questionImg: { type: String, default: null },
  },
  { timestamps: true }
);
questionSchema.plugin(idPlugin);
const Question = mongoose.model("Question", questionSchema);

// Exam Model
const examSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    type: { type: String, enum: ["timed", "untimed"], required: true },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    duration: { type: Number, required: true },
    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
    defaultAttempts: { type: Number, required: true },
    defaultExpiry: { type: Number, required: true },
    passingPercentage: { type: Number, required: true },
    reviewMode: {
      type: String,
      enum: ["practice", "assessment"],
      required: true,
    },
    opensAt: { type: String, required: true },
    closesAt: { type: String, required: true },
  },
  { timestamps: true }
);
examSchema.plugin(idPlugin);
const Exam = mongoose.model("Exam", examSchema);

// ExamAssignment Model
const examAssignmentSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    allowedAttempts: { type: Number, required: true },
    attemptsUsed: { type: Number, default: 0 },
    opensAt: { type: String, required: true },
    closesAt: { type: String, required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    bulkAssignmentId: { type: String },
    isReviewAllowed: { type: Boolean, required: true },
    lastAnsweredAt: { type: String, default: null },
  },
  { timestamps: true }
);
examAssignmentSchema.plugin(idPlugin);
const ExamAssignment = mongoose.model("ExamAssignment", examAssignmentSchema);

// ExamSession Model
const examSessionSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamAssignment",
      required: true,
    },
    grade: { type: Number, default: 0 },
    submittedAt: { type: String, default: null },
    isRunning: { type: Boolean, default: false },
    runAt: { type: String, default: null },
    pausedAt: { type: String, default: null },
    totalTimeConsumed: { type: Number, default: 0 },
    answeredQuestions: [
      { type: mongoose.Schema.Types.ObjectId, ref: "SubmittedAnswer" },
    ],
    bookmarkedQuestions: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
    ],
  },
  { timestamps: true }
);
examSessionSchema.plugin(idPlugin);
const ExamSession = mongoose.model("ExamSession", examSessionSchema);

// SubmittedAnswer Model
const submittedAnswerSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamSession",
      required: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    submittedValue: { type: mongoose.Schema.Types.Mixed, required: true },
    isCorrect: { type: Boolean, required: true },
  },
  { timestamps: true }
);
submittedAnswerSchema.plugin(idPlugin);
const SubmittedAnswer = mongoose.model(
  "SubmittedAnswer",
  submittedAnswerSchema
);

module.exports = {
  User,
  Category,
  Question,
  Exam,
  ExamAssignment,
  ExamSession,
  SubmittedAnswer,
};
