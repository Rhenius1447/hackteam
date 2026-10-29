const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  role: { type: String, enum: ['Frontend', 'Backend', 'Full Stack', 'Designer', 'Data/AI', 'Other'], required: true },
  experience: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], required: true },
  skills: [String],
  bio: { type: String, default: '' },
  avatar: { type: String, default: '' },
  passwordHash: { type: String, select: false }
}, { timestamps: true });

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  hackathon: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  maxSize: { type: Number, min: 2, max: 6, required: true },
  techStack: [String],
  lookingFor: [String],
  leader: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Participant' }]
}, { timestamps: true });

const announcementSchema = new mongoose.Schema({ title: { type: String, required: true }, body: { type: String, required: true }, pinned: { type: Boolean, default: false } }, { timestamps: true });
const messageSchema = new mongoose.Schema({ team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true }, author: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true }, text: { type: String, required: true } }, { timestamps: true });

module.exports = {
  Announcement: mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema),
  Message: mongoose.models.Message || mongoose.model('Message', messageSchema),
  Participant: mongoose.models.Participant || mongoose.model('Participant', participantSchema),
  Team: mongoose.models.Team || mongoose.model('Team', teamSchema)
};
