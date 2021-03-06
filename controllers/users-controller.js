
const Isemail = require('isemail');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const HttpError = require('../models/http-error');
const { 
  checkValidation, 
  prepareUserData, 
  prepareSelf, 
  prepareChat, 
  prepareNotification,
} = require('../util/util');
const { User, EmailListUser } = require('../models/user-schema');
const { Chat } = require('../models/chat-schema'); 

const reservedHandles = ['elon', 'json', 'chamath', 'david', 'jack', 'naval', 'kim', 'zuck', 'jeff', 'evan', 'bobby'];

const signup = async (req, res, next) => {
  checkValidation(req, next);
  const { name, email, handle, password, newsletter, anonymousId } = req.body;
  console.log('anonymousId', anonymousId);
  let user;
  //check handle
  if(reservedHandles.some(h => h === handle)) {
    return next(new HttpError(`Handle already taken. Please try another.`, 422))
  }   
  try{
    user = await User.findOne({handle: handle})
  }catch(err){ return next(new HttpError('Register User failed, please try again later.', 500))}
  if(user){    return next(new HttpError(`Handle already taken. Please try another.`, 422))}  

  //check email
  try{
    user = await User.findOne({email: email})
  }catch(err){ return next(new HttpError('Register User failed, please try again later.', 500))}
  if(user){    return next(new HttpError(`There already exists an account with your email. Please log in or choose another email.`, 422))}

  //create password hash
  let hashedPassword;
  try{
    hashedPassword = await bcrypt.hash(password, 12); 
  }catch(err){ return next(new HttpError('Could not create User, please try again', 500))}

  //create user 
  let createdUser =  new User({
    name,
    email,
    handle,
    password: hashedPassword,
    joined: new Date(),
    createdDrops: [],
    swipedLeftDrops: [],
    swipedRightDrops: [],
    savedDrops: [],
    writtenComments: [],
    friends: [],
    receivedFriendRequests: [],
    sentFriendRequests: [],
    profilePic: req.file ? true : false,
    notifications: [], 
    anonymousId: anonymousId
  });

  //upload ProfilePic
  if(req.file){
    const storage = new Storage({
      keyFilename: path.join(__dirname, '../drop-260521-cc0eb8f443d7.json'),
      projectId: 'drop-260521'
    });
    const profilePictureBucket = storage.bucket('drop-profile-pictures-bucket')

    const gcsname = `profilePic-${createdUser._id}`;
    const file = profilePictureBucket.file(gcsname);
    const stream = file.createWriteStream({
      metadata: {
        contentType: req.file.mimetype
      },
      resumable: false
    });
    stream.on('error', (err) => {
      req.file.cloudStorageError = err;
      next(err);
    });
    stream.on('finish', () => {
      req.file.cloudStorageObject = gcsname;
    });
    stream.end(req.file.buffer);
    createdUser.profilePic = true;
  }

  // JOIN EMAIL LIST 
  let emailUser;
  try {
    emailUser = await EmailListUser.findOne({email: email.toLowerCase()}).exec();
  }catch(err){
    return next(new HttpError("Something went wrong. Please try again later.", 500));
  }
  if(emailUser){
    if(!emailUser.subscribed){
      //resubscribing
      emailUser.subscribed = newsletter
    }
  }else {
    emailUser = new EmailListUser({
      email: email,
      subscribed: newsletter,
      signupDate: Date.now(), 
    })
  }

  try{
      await createdUser.save();
      await emailUser.save();
  }catch(err){ return next(new HttpError('Register User failed, please try again later.', 500))}
  let token;
  try{
    token = jwt.sign(
      { userId: createdUser.id, email: createdUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '672h' }
    );
  }catch(err){ return next(new HttpError('Register User failed, please try again later.', 500))}

  const preparedUser = prepareSelf(createdUser, token);

  res.status(201).json(preparedUser);
}

//-----------------------------------------------------------------------------------


const login = async (req, res, next) => {
  const { identification, password } = req.body;

  let existingUser;
  if(Isemail.validate(identification)){
    try {
      existingUser = await User.
        findOne({ email: identification })
        .populate({path: 'receivedFriendRequests', model: 'User'})
        .populate({path: 'sentFriendRequests', model: 'User'})
        .populate({path: 'friends', model: 'User'})
        .populate({
          path: 'chats', 
          model: 'Chat', 
          populate: {
            path: 'members',
            model: 'User'
          }
        }).exec();
    }catch(err){ 
      return next(new HttpError('Logging in failed, please try again later.', 500))
    }
  }else{
    let handle = identification
    if(!identification.startsWith('@')) handle = `@${identification}`;
    try{
      existingUser = await User.findOne({ handle: handle })
    }catch(err){ 
      return next(new HttpError('Logging in failed, please try again later.', 500))
    }
  }
  let isValidPassword = false;
  try {
    isValidPassword = await bcrypt.compare(password, existingUser.password);
  }catch(err){ 
    return next(new HttpError('Could not log you in please check your credentials and try again', 500))
  }
  if(!isValidPassword){ 
    return next(new HttpError('Email or Password wrong', 401))
  }

  let token;
  try{
    token = jwt.sign(
      { userId: existingUser.id, email: existingUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '672h' }
    );
  }catch(err){ 
    return next(new HttpError('Register User failed, please try again later.', 500))
  }
  console.log(existingUser.chats[0].members[1].name);
  const preparedUser = prepareSelf(existingUser, token)
  res.json(preparedUser)
};

//-----------------------------------------------------------------------------------

const refreshSelf = async (req, res, next) => {
  const userId = req.userData.userId;
  let self;
  try {
    self = await User.findById(userId)
      .populate({path: 'receivedFriendRequests', model: 'User'})
      .populate({path: 'sentFriendRequests', model: 'User'})
      .populate({path: 'friends', model: 'User'})
      .populate({path: 'chats', model: 'Chat', populate: 'members'})
  }catch(err){ 
    return next(new HttpError('Refresh Userdata failed. Try again later', 500))
  }
  if(!self){
    return next(new HttpError('No User foud for id', 404));
  }
  let token;
  try{
    token = jwt.sign(
      { userId, email: self.email },
      process.env.JWT_SECRET,
      { expiresIn: '672h' }
    );
  }catch(err){ 
    return next(new HttpError('Register User failed, please try again later.', 500))
  }
  const preparedSelf = await prepareSelf(self, token);
  res.json(preparedSelf);
}
//-----------------------------------------------------------------------------------


const checkHandle = async (req, res, next) => {
  const handle = req.body.handle;
  let user;
  if(!handle) return next(new HttpError("No handle provided.", 400));
  try {
    user = await User.findOne({ handle: handle })
  } catch (err) {
    return next(new HttpError('Checking handle failed, please try again later.', 500))
  }
  if(user){
    res.status(422).json({alreadyExists: true}); 
  }else{
    res.json({handleExists: false});
  }
}

//-----------------------------------------------------------------------------------


const checkEmail = async (req, res, next) => {
  checkValidation(req, next);
  const email = req.body.email;
  let user;
  try {
    user = await User.findOne({ email: email })
  } catch (err) {
    return next(new HttpError('Checking email failed, please try again later.', 500));
  }
  if(user){
    res.status(422).json({alreadyExists: true}); 
  }else{
    res.json({emailExists: false});
  }
}

//-----------------------------------------------------------------------------------


const getAllUsers = async (req, res, next) => {
  let users;
  try{
    users = await User.find({}).select('name handle profilePic');
  }catch(err){
    return next(new HttpError("Something went wrong. Please try again", 500));
  }
  const preparedUsers = users.map(prepareUserData);
  res.json(preparedUsers);
}

//-----------------------------------------------------------------------------------


const getFriendRequests = async (req, res, next) => {
  const userId = req.userData.userId;
  let user;
  try{
    user = await User.findById(userId).populate("receivedFriendRequests").exec();
  }catch(err){
    return next(new HttpError('There was a problem while fetching the friendRequests', 500));
  }
  if(!user){ 
    return next(new HttpError('No user found for given id', 400))
  }
  const preparedRequests = user.receivedFriendRequests.map(prepareUserData);
  res.json(preparedRequests);
}

//-----------------------------------------------------------------------------------


const sendFriendRequest = async (req, res, next) => {
  const userId = req.userData.userId;
  const { friendId } = req.body; 
  let friend, user;
  try { 
    user = await User.findById(userId) }
  catch(err){ return next(new HttpError("Something went wrong. Try again later", 500)) }   
  try { 
    friend = await User.findById(friendId)
  }catch(err){ return next(new HttpError("Something went wrong. Try again later", 500)) }
  if(!friend){ return next(new HttpError("No user found with FriendId", 404)) }

  if(user.receivedFriendRequests.some(id => `${id}` === friendId)){
    // Both clicked on Add siultaneously
    let chat;
    let chats = [];
    try{
      chats = await Chat.find().where('_id').in(user.chats).exec();
    }catch(err){
      return next(new HttpError("Something went wrong. Try again later", 500)) 
    }
    let existingChat = chats.find(c => c.members.some(id => `${id}` === friendId));
    if(existingChat){
      chat = existingChat;
    }else {
      chat = new Chat({
        group: false,
        members: [userId, friendId],
        admins: [userId, friendId],
        messages: [],
        lastInteraction: Date.now(),
      })
      user.chats.push(chat._id);
    }
    friend.chats.push(chat._id);
    friend.sentFriendRequests.pull(userId);
    friend.friends.push(userId);
    user.receivedFriendRequests.pull(friendId);
    user.friends.push(friendId);
    try{
      await user.save();
      await friend.save();
      await chat.save();
    }catch(err){
      return next(new HttpError('Something went wrong. Please Try again later', 500));
    }
    chat.members = [user, friend];
    const preparedChat = prepareChat(chat);
    res.json({message: "Both requested. Friendshit established", chat: preparedChat})
  } else {
    if(!friend.receivedFriendRequests.includes(userId)){ 
      friend.receivedFriendRequests.push(userId);
    }
    if(!user.sentFriendRequests.includes(friendId)){ 
      user.sentFriendRequests.push(friendId);
    }
    try {
      await friend.save();
      await user.save();
    }catch(err){
      return next(new HttpError("Something went wrong, please try again later", 500)); 
    }
  
    res.json({message: "Friend Request Sent!"})
  }
}



//-----------------------------------------------------------------------------------

const getNotifications = async (req, res, next) => {
  const userId = req.userData.userId;
  let user;
  try { 
    user = await User.findById(userId) 
  }
  catch(err){ 
    return next(new HttpError("Something went wrong. Try again later", 500)) 
  } 
  if(!user){
    return next(new HttpError("User not found", 404));
  }

  const preparedNotifications = user.notifications.map(prepareNotification); 
  res.json(preparedNotifications);
}


//-----------------------------------------------------------------------------------

const acceptFriendRequest = async (req, res, next) => {
  const userId = req.userData.userId;
  const { friendId } = req.body;
  let user;
  try { 
    user = await User.findById(userId) }
  catch(err){  
    return next(new HttpError("Something went wrong. Try again later", 500)) 
  }   
  let friend;
  try { 
    friend = await User.findById(friendId) }
  catch(err){  
    return next(new HttpError("Something went wrong. Try again later", 500)) 
  } 
  if(!friend){ 
    return next(new HttpError("No user found with FriendId", 404)) 
  }
  if(!user.receivedFriendRequests.includes(friendId)){
    return next(new HttpError("No Friend Request found", 404));
  }
  if(!friend.sentFriendRequests.includes(userId)) {
    return next(new HttpError("No Friend Request found", 404));
  }
  let chat;
  let chats = [];
  try{
    chats = await Chat.find().where('_id').in(user.chats).exec();
  }catch(err){
    return next(new HttpError("Something went wrong. Try again later", 500)) 
  }
  let existingChat = chats.find(c => c.members.some(id => `${id}` === friendId));
  if(existingChat){

    chat = existingChat
    chat.members = [user, friend];
  }else {
    chat = new Chat({
      group: false,
      members: [user, friend],
      admins: [userId, friendId],
      messages: [],
      lastInteraction: Date.now(),
    })
    friend.chats.push(chat._id);
    user.chats.push(chat._id);
  }
  user.receivedFriendRequests.pull(friendId);
  user.friends.push(friendId);
  friend.sentFriendRequests.pull(userId);
  friend.friends.push(userId);
  try{
    await friend.save();
    await user.save();
    await chat.save();
  }catch(err){ 
    return next(new HttpError('Something went wrong while saving. Please try again later', 500))
  }


  const preparedFriend = prepareUserData(friend);
  const preparedChat = prepareChat(chat);
  res.json({ friend: preparedFriend, chat: preparedChat});
}

//-----------------------------------------------------------------------------------

const deleteNotification = async (req, res, next) => {
  const { notificationId } = req.params;
  const { userId } = req.userData;
  let user;
  try{
    user = await User.findById(userId).populate("receivedFriendRequests").exec();
  }catch(err){
    return next(new HttpError('There was a problem. Please try again later.', 500));
  }
  user.notifications.pull({_id: notificationId})
  try {
    user.save();
  }catch(err){
    return next(new HttpError('There was a problem. Please try again later.', 500));
  }
  res.json({message: "notification removed successfully"});
}

//-----------------------------------------------------------------------------------

const getDataForUsers = async (req, res, next) => {
  const { userIds } = req.body;
  let users;
  try {
    users = await User.find().where('_id').in(userIds).exec();
  }catch(err){
    return next(new HttpError("Someting went wrong. Please try again later", 500));
  } 
  const preparedUsers = users.map(prepareUserData);
  res.json(preparedUsers);
}

const joinEmailList = async (req, res, next) => {
  if(!req.body || !req.body.email){
    return next(new HttpError("No email provided", 400));
  }
  const email = req.body.email.toLowerCase();
  let existingEmailListUser;
  try {
    existingEmailListUser = await EmailListUser.findOne({email: email}).exec();
  }catch(err){
    return next(new HttpError("Something went wrong. Please try again later.", 500));
  }
  if(existingEmailListUser){
    if(existingEmailListUser.subscribed){
      return next(new HttpError("User already subscribed", 409))
    }else {
      //resubscribing
      existingEmailListUser.subscribed = true
      try {
        await existingEmailListUser.save();
      }catch(err){
        return next(new HttpError("Something went wrong. Please Try again later", 500))
      }
      res.status(201).json({message: "Reubscribed successfully"}, 201)
    }
  }
  const newSubscriber = new EmailListUser({
    email: req.body.email,
    subscribed: true,
    signupDate: Date.now(), 
  })
  try {
    await newSubscriber.save();
  }catch(err){
    return next(new HttpError("Something went wrong. Please try again later", 500));
  }
  res.json({message: "Subscribed!"});
}

exports.checkHandle = checkHandle;
exports.checkEmail = checkEmail;
exports.signup = signup;
exports.login = login;
exports.getAllUsers = getAllUsers;
exports.sendFriendRequest = sendFriendRequest;
exports.acceptFriendRequest = acceptFriendRequest;
exports.getDataForUsers = getDataForUsers;
exports.getFriendRequests = getFriendRequests;
exports.refreshSelf = refreshSelf;
exports.getNotifications = getNotifications;
exports.deleteNotification = deleteNotification;
exports.joinEmailList = joinEmailList;