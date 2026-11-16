import { requestStatusEnum } from "../../common/enum/identityRequest.enum.js";
import {
  BadException,
  ConflictException,
  ForbiddenException,
  NotfoundException,
} from "../../common/exceptions/error.exception.js";
import { requestModel } from "../../DB/model/identityRequests.model.js";
import { messageModel } from "../../DB/model/message.model.js";
import { UserModel } from "../../DB/model/user.model.js";

export const sendAnonymousMessage = async (senderId, recieverId, content) => {
  // prevent send to yourself
  if (senderId.toString() == recieverId.toString()) {
    throw BadException("You cannot send to yourself");
  }

  //   check if the reciever exists
  const reciever = await UserModel.findById(recieverId);
  if (!reciever) {
    throw NotfoundException("reciever not found");
  }

  const message = await messageModel.create({ senderId, recieverId, content });
  return {
    _id: message._id,
    content: message.content,
    createdAt: message.createdAt,
  };
};

// get recieved messages
export const getRecievedMessages = async (recieverId) => {
  const messages = await messageModel
    .find({ recieverId })
    .populate("senderId", "firstName lastName profilePicture")
    .sort({ createdAt: -1 });

  const filteredMessages = messages.map((message) => ({
    _id: message._id,
    content: message.content,
    createdAt: message.createdAt,
    sender: message.anonymous ? null : message.senderId,
  }));
  return filteredMessages;
};

export const requestSenderIdentity = async (requesterId, messageId) => {
  // find the message
  const message = await messageModel.findById(messageId);
  if (!message) {
    throw NotfoundException("Message not found");
  }
  // ensure that requester is the original message reciever
  if (message.recieverId.toString() !== requesterId.toString()) {
    throw ForbiddenException(
      "You are not authorized to request identity for this message",
    );
  }
  // check if identity is already revealed
  if (!message.anonymous) {
    throw BadException("sender identity is already revealed");
  }
  //   check if the request already exists
  const existingRequest = await requestModel.findOne({ messageId });
  if (existingRequest) {
    throw ConflictException("Request already exists");
  }
  //   create request
  const request = await requestModel.create({
    messageId,
    senderId: message.senderId,
    requesterId,
  });
  return request;
};

export const getRequests = async (senderId) => {
  const requests = await requestModel
    .find({ senderId })
    .populate("requesterId", "firstName lastName profilePicture")
    .populate("messageId", "content createdAt")
    .sort({ createdAt: -1 });

  return requests;
};

export const rejectRequest = async (requestId, senderId) => {
  // find the request
  const request = await requestModel.findById(requestId);
  if (!request) {
    throw NotfoundException("request not found");
  }
  console.log({ senderId });
  console.log({ requestSender: request.senderId });
  // only the original sender can reject
  if (request.senderId.toString() !== senderId.toString()) {
    throw ForbiddenException("You are not authorized to reject the request");
  }
  // check if status is pending
  if (request.status !== requestStatusEnum.pending) {
    throw BadException("request already processed");
  }
  // reject request
  request.status = requestStatusEnum.rejected;
  await request.save();

  return request;
};

export const acceptRequest = async (requestId, senderId) => {
  // find the request
  const request = await requestModel.findById(requestId);
  if (!request) {
    throw NotfoundException("request not found");
  }
  // only the original sender can accept
  if (request.senderId.toString() !== senderId.toString()) {
    throw ForbiddenException("You are not authorized to accept the request");
  }
  // check if status is pending
  if (request.status !== requestStatusEnum.pending) {
    throw BadException("request already processed");
  }
  // accept request
  request.status = requestStatusEnum.accepted;
  await request.save();

  // message became not anonymous
  await messageModel.findByIdAndUpdate(request.messageId, { anonymous: false });

  //   create conversation
  return request;
};
