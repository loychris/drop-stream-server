const mongoose = require('mongoose');
const uniqueValidator = require('mongoose-unique-validator');

const Schema = mongoose.Schema;


const userSchema = new Schema({
    name: { type: String, required: true },
    _id: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, minlength: 6 },
    createdDrops: [{ type: mongoose.Types.ObjectId, ref: 'Drop'}],
    swipedLeftDrops: [{ type: mongoose.Types.ObjectId, ref: 'Drop'}],
    swipedRightDrops: [{ type: mongoose.Types.ObjectId, ref: 'Drop'}],
    savedDrops: [{ type: mongoose.Types.ObjectId, ref: 'Drop'}],
    writtenComments: [{ type: mongoose.Types.ObjectId, ref: 'Comment'}]
});

userSchema.plugin(uniqueValidator);

module.exports = mongoose.model('User', userSchema);