import mongoose from "mongoose";
import { requestStatusEnum } from "../../common/enum/identityRequest.enum.js";

const RequestSchema = new mongoose.Schema(
  {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
      unique: true,
    },
    // the sender of the original message WHO ACCEPTS/REJECT the request
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // the reciever of the original message WHO REQUESTS the sender identity
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(requestStatusEnum),
      default: requestStatusEnum.pending,
    },
  },
  { collection: "requests", timestamps: true },
);

export const requestModel = mongoose.model("Request", RequestSchema);
