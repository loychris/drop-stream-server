const express = require("express");
const { check } = require("express-validator");

const auth = require('../middleware/check-auth');

const commentController = require("../controllers/comment-controller");

const router = express.Router();

router.get("/comment/:commentId", commentController.getComment);
router.patch("/comment/:commentId", auth, commentController.updateComment);
router.delete("/comment/:commentId", auth, commentController.deleteComment);
router.post("/drop/:dropId/comment", auth, commentController.createComment);
router.post("/comment/:commentId/vote", auth, commentController.voteComment);
router.post("/comment/:commentId/sub", auth, commentController.createSubComment);
router.post("/comment/:commentId/delSub", auth, commentController.deleteSubComment);
router.post("/comment/:commentId/voteSub", auth, commentController.voteSubComment);


module.exports = router;
