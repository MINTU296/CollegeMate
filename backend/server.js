require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const multer = require("multer");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

// ------------------------
// Middleware
// ------------------------
app.use(bodyParser.json());
app.use(cors());

// ------------------------
// MongoDB Connection
// ------------------------
const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/myapp";
mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ------------------------
// Serve static files
// ------------------------
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`Created folder: ${uploadsDir}`);
}

// ------------------------
// Multer for File Uploads
// ------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// ------------------------
// User Schema and Model
// ------------------------
const userSchema = new mongoose.Schema({
  firstName:  { type: String, required: true },
  lastName:   { type: String, required: true },
  email:      { type: String, required: true, unique: true },
  password:   { type: String, required: true },
  profileImage: { type: String, default: "" },
  bio:        { type: String, default: "" },
  location:   { type: String, default: "" },
  website:    { type: String, default: "" },
  followers:  [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  following:  [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt:  { type: Date, default: Date.now },
});
const User = mongoose.model("User", userSchema);

// ------------------------
// Post Schema and Model
// ------------------------
const postSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text:      { type: String, required: true },
  image:     { type: String, default: "" },
  video:     { type: String, default: "" },
  likes:     { type: Number, default: 0 },
  likedBy:   [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  shares:    { type: Number, default: 0 },
  comments: [
    {
      userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      text:     { type: String },
      createdAt:{ type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});
const Post = mongoose.model("Post", postSchema);

// ------------------------
// Signup (profile image optional)
// ------------------------
app.post("/signup", upload.single("profileImage"), async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User with that email already exists." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
    });
    if (req.file) {
      newUser.profileImage = req.file.filename;
    }
    await newUser.save();
    return res.status(201).json({ message: "Sign up successful.", userId: newUser._id });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Login
// ------------------------
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required." });
    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Invalid credentials." });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials." });
    return res.status(200).json({ message: "Login successful.", userId: user._id });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Get User Profile
//    - Now returns followersCount, followingCount
//    - Optionally returns isFollowing if you pass ?myId=<loggedInUserId>
// ------------------------
app.get("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const myId = req.query.myId; // e.g. /profile/123?myId=456

    // Populate followers/following
    const user = await User.findById(id)
      .select("-password")
      .populate("followers", "firstName lastName profileImage")
      .populate("following", "firstName lastName profileImage");

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Compute counts
    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;

    // Check if "myId" is following this user
    let isFollowing = false;
    if (myId && myId !== id) {
      isFollowing = user.followers.some((f) => f._id.toString() === myId);
    }

    return res.status(200).json({
      user: {
        ...user._doc,
        followersCount,
        followingCount,
        isFollowing,
      },
    });
  } catch (err) {
    console.error("Get profile error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Update Profile
// ------------------------
app.post("/profile/update", upload.single("profileImage"), async (req, res) => {
  try {
    const { userId, firstName, lastName, email, bio, location, website } = req.body;
    if (!userId)
      return res.status(400).json({ message: "User ID is required." });
    let updateData = { firstName, lastName, email, bio, location, website };
    if (req.file) {
      updateData.profileImage = req.file.filename;
    }
    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true })
      .select("-password");
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.status(200).json({ message: "Profile updated successfully.", user: updatedUser });
  } catch (err) {
    console.error("Profile update error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Follow a User
// ------------------------
app.post("/user/follow", async (req, res) => {
  try {
    const { userId, targetId } = req.body; // userId = me, targetId = user to follow
    if (!userId || !targetId) {
      return res.status(400).json({ message: "userId and targetId are required." });
    }
    if (userId === targetId) {
      return res.status(400).json({ message: "You cannot follow yourself." });
    }

    const me = await User.findById(userId);
    const them = await User.findById(targetId);
    if (!me || !them) {
      return res.status(404).json({ message: "User not found." });
    }

    // If I'm not already following them
    if (!me.following.includes(targetId)) {
      me.following.push(targetId);
      await me.save();
    }
    // If they don't already have me in their followers
    if (!them.followers.includes(userId)) {
      them.followers.push(userId);
      await them.save();
    }

    return res.status(200).json({ message: "Followed successfully." });
  } catch (err) {
    console.error("Follow user error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Unfollow a User
// ------------------------
app.post("/user/unfollow", async (req, res) => {
  try {
    const { userId, targetId } = req.body; // userId = me, targetId = user to unfollow
    if (!userId || !targetId) {
      return res.status(400).json({ message: "userId and targetId are required." });
    }

    const me = await User.findById(userId);
    const them = await User.findById(targetId);
    if (!me || !them) {
      return res.status(404).json({ message: "User not found." });
    }

    // Remove target from my following
    me.following = me.following.filter((id) => id.toString() !== targetId);
    await me.save();

    // Remove me from their followers
    them.followers = them.followers.filter((id) => id.toString() !== userId);
    await them.save();

    return res.status(200).json({ message: "Unfollowed successfully." });
  } catch (err) {
    console.error("Unfollow user error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Get Followers List
// ------------------------
app.get("/users/:userId/followers", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).populate("followers", "firstName lastName profileImage");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.status(200).json(user.followers);
  } catch (err) {
    console.error("Get followers error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Get Following List
// ------------------------
app.get("/users/:userId/following", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).populate("following", "firstName lastName profileImage");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.status(200).json(user.following);
  } catch (err) {
    console.error("Get following error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Create a New Post
// ------------------------
app.post(
  "/post",
  upload.fields([
    { name: "postImage", maxCount: 1 },
    { name: "postVideo", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { userId, text } = req.body;
      if (!userId || !text) {
        return res.status(400).json({ message: "User ID and text are required." });
      }
      let newPostData = { userId, text };
      if (req.files && req.files.postImage) {
        newPostData.image = req.files.postImage[0].filename;
      }
      if (req.files && req.files.postVideo) {
        newPostData.video = req.files.postVideo[0].filename;
      }
      const newPost = new Post(newPostData);
      await newPost.save();
      return res.status(201).json({ message: "Post created successfully.", post: newPost });
    } catch (err) {
      console.error("Create post error:", err);
      return res.status(500).json({ message: "Server error." });
    }
  }
);

// ------------------------
// GET Single Post (CommentScreen)
// ------------------------
app.get("/post/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findById(id).populate("comments.userId", "firstName lastName profileImage");
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }
    return res.status(200).json({ post });
  } catch (err) {
    console.error("Get single post error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Toggle Like
// ------------------------
app.post("/post/like", async (req, res) => {
  try {
    const { postId, userId } = req.body;
    if (!postId || !userId) {
      return res.status(400).json({ message: "postId and userId are required." });
    }
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }
    const alreadyLiked = post.likedBy.some((id) => id.toString() === userId);
    if (alreadyLiked) {
      // Remove like
      post.likedBy = post.likedBy.filter((id) => id.toString() !== userId);
      post.likes = Math.max(post.likes - 1, 0);
    } else {
      // Add like
      post.likedBy.push(userId);
      post.likes += 1;
    }
    await post.save();
    return res.status(200).json({ message: "Post like updated.", likes: post.likes, likedBy: post.likedBy });
  } catch (err) {
    console.error("Toggle like error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Add Comment
// ------------------------
app.post("/post/comment", async (req, res) => {
  try {
    const { postId, userId, commentText } = req.body;
    if (!postId || !userId || !commentText) {
      return res.status(400).json({ message: "postId, userId, and commentText are required." });
    }
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    const comment = {
      userId,
      text: commentText,
      createdAt: new Date(),
    };
    post.comments.push(comment);

    await post.save();
    await post.populate("comments.userId", "firstName lastName profileImage");

    return res.status(200).json({ message: "Comment added.", comments: post.comments });
  } catch (err) {
    console.error("Add comment error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Share Post
// ------------------------
app.post("/post/share", async (req, res) => {
  try {
    const { postId, userId } = req.body;
    if (!postId || !userId) {
      return res.status(400).json({ message: "postId and userId are required." });
    }
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }
    post.shares += 1;
    await post.save();
    return res.status(200).json({ message: "Post shared successfully.", shares: post.shares });
  } catch (err) {
    console.error("Share post error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Get Posts
//   - Returns all posts if no userId query param is provided
//   - Populate userId to get userName, userAvatar, etc.
// ------------------------
app.get("/posts", async (req, res) => {
  try {
    const { userId } = req.query;
    let filter = {};
    if (userId) {
      filter = { userId };
    }
    let posts = await Post.find(filter)
      .populate("userId", "firstName lastName profileImage")
      .sort({ createdAt: -1 });

    const mappedPosts = posts.map((post) => {
      const userDoc = post.userId;
      return {
        _id: post._id,
        userId: userDoc._id,
        userName: `${userDoc.firstName} ${userDoc.lastName}`,
        userAvatar: userDoc.profileImage,
        text: post.text,
        image: post.image,
        video: post.video,
        likes: post.likes,
        likedBy: post.likedBy,
        shares: post.shares,
        comments: Array.isArray(post.comments) ? post.comments.length : 0,
        createdAt: post.createdAt,
      };
    });

    return res.status(200).json(mappedPosts);
  } catch (err) {
    console.error("Get posts error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ------------------------
// Start the Server
// ------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
