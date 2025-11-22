# Aviation Exam Backend

Express.js backend with MongoDB Atlas for managing exams, assignments, and student assessments.

## Setup

1. **Install dependencies:**

```bash
npm install
```

2. **Create `.env` file in root directory:**

```env
MONGO_URI="mongodb+srv://dawoodkhalid33:hM8iPN7pbtHlYIIk@cluster0.gigyg.mongodb.net/aviation-exam-db?retryWrites=true&w=majority&appName=Cluster0"
PORT=5000
JWT_SECRET=randomstring1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ
JWT_EXPIRATION="7d"
```

3. **Create first admin user manually:**

```javascript
// createAdmin.js
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
```

Run: `node createAdmin.js`

4. **Start server:**

```bash
npm start
# or for development with auto-reload
npm run dev
```

## Project Structure

```
.
├── server.js              # Main server file
├── models/
│   └── index.js          # All Mongoose models
├── routes/
│   ├── auth.js           # Authentication routes
│   ├── users.js          # User CRUD
│   ├── categories.js     # Category CRUD
│   ├── questions.js      # Question CRUD
│   ├── exams.js          # Exam CRUD
│   ├── examAssignments.js # Assignment management
│   ├── examSessions.js   # Exam session management
│   └── submittedAnswers.js # Answer submission
└── middleware/
    └── auth.js           # Auth middleware
```

## API Endpoints

### Authentication

- `POST /api/auth/login` - Login (returns JWT token)
- `GET /api/auth/me` - Get current user

### Users (Admin only)

- `POST /api/users` - Create user
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Categories (Admin only for CUD, All for R)

- `POST /api/categories` - Create category
- `GET /api/categories` - Get all categories
- `GET /api/categories/:id` - Get category by ID
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category

### Questions (Admin only)

- `POST /api/questions` - Create question
- `GET /api/questions` - Get all questions
- `GET /api/questions/:id` - Get question by ID
- `PUT /api/questions/:id` - Update question
- `DELETE /api/questions/:id` - Delete question

### Exams

- `POST /api/exams` - Create exam (admin only)
- `GET /api/exams` - Get all exams
- `GET /api/exams/:id` - Get exam by ID
- `PUT /api/exams/:id` - Update exam (admin only)
- `DELETE /api/exams/:id` - Delete exam (admin only)

### Exam Assignments

- `POST /api/exam-assignments/bulk` - Bulk create assignments (admin only)
- `GET /api/exam-assignments` - Get all assignments (filtered by role)
- `GET /api/exam-assignments/:id` - Get assignment by ID
- `PUT /api/exam-assignments/:id` - Update assignment (admin only)
- `DELETE /api/exam-assignments/:id` - Delete assignment (admin only)

### Exam Sessions

- `POST /api/exam-sessions/start` - Start exam session
- `POST /api/exam-sessions/resume/:sessionId` - Resume exam session
- `GET /api/exam-sessions` - Get all sessions (filtered by role)
- `GET /api/exam-sessions/:id` - Get session by ID

### Submitted Answers

- `POST /api/submitted-answers` - Submit answer (auto-grades and returns next question)
- `GET /api/submitted-answers/session/:sessionId` - Get answers by session (admin only)
- `GET /api/submitted-answers` - Get all answers (admin only)

## Authentication

All protected routes require JWT token in Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Key Features

- **Time tracking:** All times stored as Unix timestamps (seconds)
- **Auto-population:** All responses include fully populated nested objects
- **ID mapping:** MongoDB `_id` automatically converted to `id` in responses
- **Timestamps:** All documents have `createdAt` and `updatedAt` (in seconds)
- **Role-based access:** Admin and student roles with appropriate permissions
- **Exam session management:** Start, resume, auto-submit on completion
- **Auto-grading:** Questions graded automatically on submission
- **Bulk operations:** Bulk assignment creation for efficiency

## Example Workflow

1. Admin logs in and creates categories, questions, and exams
2. Admin bulk assigns exam to students
3. Student logs in and sees available assignments
4. Student starts exam session (gets first question)
5. Student submits answers (gets next question automatically)
6. On last answer submission, exam auto-submits and grade is finalized
7. Admin can view all sessions and submitted answers

## Notes

- First admin must be created manually via script
- All times are in seconds (Unix timestamps)
- Questions support MCQ and short answer types
- Exams can be timed or untimed
- Review mode: practice (review allowed) or assessment (review restricted)
- Plus/minus marking supported via plusT and minusT fields
