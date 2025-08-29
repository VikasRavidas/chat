const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const Pusher = require("pusher");

const connectDB = require('./config/db');
const User = require('./models/User');
const Post = require('./models/Post');

const app = express();

// Connect to MongoDB
connectDB();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});


// Middleware
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(bodyParser.json());

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const token = req.header("Authorization")?.split("Bearer ")[1];
  if (!token) {
    return res.status(401).json({ success: false, error: "Access denied, token missing!" });
  }
  try {
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: "Invalid token" });
  }
}

// --- API Routes ---
app.post("/api/v2/messages", authenticateToken, async (req, res) => {
  const { message, chatroom } = req.body;
  try {
    // Trigger a 'new-message' event on the specified 'chatroom' channel
    await pusher.trigger(chatroom, "new-message", {
      message: message,
      user_email: req.user.email,
      name: req.user.name
    });
    res.json({ success: true, message: "Message sent" });
  } catch (error) {
    console.error("Pusher Trigger Error:", error.message);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
});
// USER ROUTES
app.post("/api/v2/users/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ success: false, error: "Email already in use" });
    const hashedPassword = bcrypt.hashSync(password, 10);
    user = new User({ name, email, password: hashedPassword });
    await user.save();
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, process.env.SECRET_KEY, { expiresIn: "1h" });
    res.json({ success: true, message: "Signup successful", token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});

app.post("/api/v2/users/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, process.env.SECRET_KEY, { expiresIn: "1h" });
    res.json({ success: true, message: "Login successful", token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});

app.post("/api/v2/users/search", authenticateToken, async (req, res) => {
    const { searchText } = req.body;
    try {
        if (!searchText || searchText.trim() === "") {
            return res.json({ success: true, data: { users: [] } });
        }
        const users = await User.find({
            _id: { $ne: req.user.id }, // Exclude current user
            $or: [
                { name: { $regex: searchText, $options: "i" } },
                { email: { $regex: searchText, $options: "i" } }
            ]
        }).select('-password -friends');
        res.json({ success: true, data: { users } });
    } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});


app.post("/api/v2/users/edit", authenticateToken, async (req, res) => {
    const { id, name, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
        return res.status(400).json({ success: false, error: "Passwords do not match" });
    }
    try {
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ success: false, error: "User not found" });

        user.name = name;
        user.password = bcrypt.hashSync(password, 10);
        await user.save();
        
        const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, process.env.SECRET_KEY, { expiresIn: "1h" });
        res.json({ success: true, message: "Profile updated successfully", token, user: { id: user.id, name: user.name, email: user.email }});
    } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});


app.get("/api/v2/user/:id", async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return res.status(404).json({ success: false, error: "User not found" });
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});


// POST ROUTES
app.get("/api/v2/posts", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const startIndex = (page - 1) * limit;
  try {
    const posts = await Post.find()
      .populate('user', 'id name email')
      .populate('comments.user', 'id name email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex);
    res.json({ success: true, data: { posts } });
  } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});


app.post("/api/v2/posts/create", authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content || content.trim() === "") return res.status(400).json({ success: false, error: "Post content cannot be empty" });
  try {
    const post = new Post({ content, user: req.user.id });
    await post.save();
    await post.populate('user', 'id name email');
    res.status(201).json({ success: true, message: "Post created successfully", post });
  } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});


// COMMENT & LIKE ROUTES
app.post("/api/v2/comments", authenticateToken, async (req, res) => {
  const { content, postId } = req.body;
  try {
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    const newComment = { content, user: req.user.id };
    post.comments.push(newComment);
    await post.save();
    const createdComment = post.comments[post.comments.length - 1];
    await post.populate('comments.user', 'id name email');
    res.status(201).json({ success: true, message: "Comment added successfully", comment: createdComment });
  } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});


app.post("/api/v2/likes/toggle", authenticateToken, async (req, res) => {
    const { id, likeType } = req.body;
    const userId = req.user.id;
    try {
        if (likeType === 'post') {
            const post = await Post.findById(id);
            if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
            const likeIndex = post.likes.indexOf(userId);
            if (likeIndex > -1) post.likes.splice(likeIndex, 1);
            else post.likes.push(userId);
            await post.save();
            return res.json({ success: true, data: { likeable: post, userId, type: 'post' }});
        } else if (likeType === 'comment') {
            const post = await Post.findOne({ "comments._id": id });
            if (!post) return res.status(404).json({ success: false, error: 'Comment not found' });
            const comment = post.comments.id(id);
            const likeIndex = comment.likes.indexOf(userId);
            if (likeIndex > -1) comment.likes.splice(likeIndex, 1);
            else comment.likes.push(userId);
            await post.save();
            return res.json({ success: true, data: { likeable: comment, userId, type: 'comment', postId: post.id }});
        } else {
            return res.status(400).json({ success: false, error: 'Invalid likeType' });
        }
    } catch (error) { res.status(500).json({ success: false, error: 'Server Error' }); }
});


// FRIENDSHIP ROUTES
app.get("/api/v2/friendship/fetch_user_friends", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('friends', 'id name email');
        if (!user) return res.status(404).json({ success: false, error: "User not found" });
        res.json({ success: true, friends: user.friends });
    } catch (error) { res.status(500).json({ success: false, error: "Server Error" }); }
});

app.post("/api/v2/friendship/add", authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { friendId } = req.body;
    try {
        await User.findByIdAndUpdate(userId, { $addToSet: { friends: friendId } });
        await User.findByIdAndUpdate(friendId, { $addToSet: { friends: userId } });
        const friend = await User.findById(friendId).select('-password');
        res.json({ success: true, message: "Friend added successfully", friend });
    } catch (error) { res.status(500).json({ success: false, error: "Server Error" }); }
});

app.post("/api/v2/friendship/remove", authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { friendId } = req.body;
    try {
        await User.findByIdAndUpdate(userId, { $pull: { friends: friendId } });
        await User.findByIdAndUpdate(friendId, { $pull: { friends: userId } });
        const removedFriend = await User.findById(friendId).select('-password');
        res.json({ success: true, message: "Friend removed successfully", friend: removedFriend });
    } catch (error) { res.status(500).json({ success: false, error: "Server Error" }); }
});


// Export for Vercel
module.exports = app;