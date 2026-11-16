import { CLIENT_ID, FRONTEND_URL } from "../../../config/config.service.js";
import { providerEnum } from "../../common/enum/user.enum.js";
import {
  BadException,
  ConflictException,
  NotfoundException,
} from "../../common/exceptions/error.exception.js";
import {
  deleteKeys,
  expire,
  get,
  increment,
  set,
  ttl,
} from "../../common/services/redis.service.js";
import { sendEmail } from "../../common/utils/email/send.email.js";
import { generateEncrypt } from "../../common/utils/security/encrypt.security.js";
import {
  compareHash,
  generateHash,
} from "../../common/utils/security/hash.security.js";
import { generateOTP } from "../../common/utils/security/otp.security.js";
import { createLoginCredentials } from "../../common/utils/security/token.security.js";
import * as dbService from "../../DB/db.repository.js";
import { UserModel } from "../../DB/model/user.model.js";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

export const signup = async (inputs) => {
  const { username, email, password, phone } = inputs;

  const emailExists = await dbService.findOne({
    model: UserModel,
    filter: { email },
  });
  if (emailExists) {
    throw ConflictException("Email already exists");
  }

  const user = await dbService.createOne({
    model: UserModel,
    data: {
      username,
      email,
      password: await generateHash({ plaintext: password }),
      phone: await generateEncrypt(phone),
    },
  });

  const otp = await generateOTP(); //number

  // string => hash => save
  await set({
    key: `OTP::USER::${email}`,
    value: await generateHash({ plaintext: `${otp}` }),
    ttl: 300,
  });
  await sendEmail({
    to: email,
    subject: "Email Confirmation",
    html: `<h1>OTP: ${otp}</h1>`,
  });
  return user;
};

export const confirmEmail = async (inputs) => {
  const { email, otp } = inputs;

  const user = await dbService.findOne({
    model: UserModel,
    filter: {
      email,
      confirmEmail: { $eq: null },
      provider: providerEnum.System,
    },
  });
  if (!user) {
    return NotfoundException("Email not found or already confirmed");
  }

  const hashedOTP = await get(`OTP::USER::${email}`); // expired
  if (!hashedOTP) {
    return BadException("Expired otp!");
  }

  if (!(await compareHash({ plaintext: otp, cipherText: hashedOTP }))) {
    return BadException("Invalid otp!");
  }

  user.confirmEmail = new Date();
  await user.save();

  return;
};

export const resendConfirmEmail = async (inputs) => {
  const { email } = inputs;

  const user = await dbService.findOne({
    model: UserModel,
    filter: {
      email,
      confirmEmail: { $eq: null },
      provider: providerEnum.System,
    },
  });
  if (!user) {
    return NotfoundException("Email not found or already confirmed");
  }

  const otpTTL = await ttl(`OTP::USER::${email}`); // -1 || -2 || >0
  if (otpTTL > 0) {
    return ConflictException(
      "You cannot request new otp as the oldone is still valid",
    );
  }
  const otp = await generateOTP(); //number

  // string => hash => save
  await set({
    key: `OTP::USER::${email}`,
    value: await generateHash({ plaintext: `${otp}` }),
    ttl: 300,
  });
  await sendEmail({
    to: email,
    subject: "Email Confirmation",
    html: `<h1>OTP: ${otp}</h1>`,
  });
  return user;
};

export const login = async (inputs, issuer) => {
  const { email, password } = inputs;

  // check if the user is banned
  const attemptsKey = `FAIL::LOGIN::${email}`; //track failed attempts
  const attempts = await get(attemptsKey); // return failed attempts count
  const remaining = await ttl(attemptsKey); //return remaining time
  if (attempts && attempts >= 5) {
    throw BadException(`Your account is banned, try again after ${remaining}s`);
  }

  // 1. Find user
  const user = await dbService.findOne({
    model: UserModel,
    filter: {
      email,
      confirmEmail: { $exists: true },
      provider: providerEnum.System,
    },
  });
  if (!user) {
    throw NotfoundException("In-valid email or not confirmed yet");
  }

  // 2. Compare password with stored hash
  const match = await compareHash({
    plaintext: password,
    cipherText: user.password,
  });

  if (!match) {
    const attempts = await increment(attemptsKey);
    if (attempts === 1) {
      await expire({ key: attemptsKey, ttl: 300 });
    }
    if (attempts >= 5) {
      throw BadException("Too many failed attempts, try again after 5 minutes");
    }
    throw BadException(`Invalid password. Attempt ${attempts}/5`);
    // throw NotfoundException("Invalid email or password");
  }

  await deleteKeys([attemptsKey]);

  if (user.twoFactorEnabled) {
    // generate otp =>  save otp hashed in redis => send email to user with the otp
    const otp = await generateOTP(); //number
    const FAKey = `2FA::${email}`;
    await set({
      key: FAKey,
      value: await generateHash({ plaintext: `${otp}` }),
      ttl: 600,
    });

    await sendEmail({
      to: email,
      subject: "Two step verification",
      html: `<h1>OTP: ${otp}</h1>`,
    });

    return { message: "Enter the OTP sent to your email" };
  }

  // 3. Generate Access + Refresh Tokens
  const credentials = await createLoginCredentials(user, issuer);

  return credentials;
};

export const confirmLogin = async (inputs, issuer) => {
  const { email, otp } = inputs;

  const user = await dbService.findOne({ model: UserModel, filter: { email } });
  if (!user) {
    throw NotfoundException("Account not found");
  }

  if (!user.twoFactorEnabled) {
    throw ConflictException("Two step verification is not enabled");
  }

  const FAKey = `2FA::${email}`;
  const hashedOTP = await get(FAKey);
  if (!hashedOTP) {
    throw BadException("EXPIRED OTP");
  }

  const isMatch = await compareHash({ plaintext: otp, cipherText: hashedOTP });
  if (!isMatch) {
    throw BadException("Invalid OTP");
  }

  await deleteKeys([FAKey]);
  const credentials = await createLoginCredentials(user, issuer);

  return credentials;
};

export const ContinueWithGoogle = async ({ idToken }, issuer) => {
  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload) {
    throw BadException("Google cannot verify this account");
  }
  console.log({ payload });
  // 3 options
  // 1- user already exists -- provider system  --> throw error
  // 2- user already exists -- provider google --> login credentials
  // 3- user not registered yet --> register --> login credentials

  const userExists = await dbService.findOne({
    model: UserModel,
    filter: { email: payload.email },
  });
  if (userExists) {
    if (userExists.provider == providerEnum.System) {
      throw ConflictException("Email already exists with different provider");
    }
    // Generate Access + Refresh Tokens
    const credentials = await createLoginCredentials(userExists, issuer);
    return { status: 200, credentials };
  }
  // register user
  const user = await dbService.createOne({
    model: UserModel,
    data: {
      username: payload.name,
      email: payload.email,
      confirmEmail: Date.now(),
      provider: providerEnum.Google,
    },
  });
  // Generate Access + Refresh Tokens
  const credentials = await createLoginCredentials(user, issuer);
  return { status: 201, credentials };
};

export const twoFactorEnableRequest = async (user) => {
  if (user.twoFactorEnabled) {
    throw ConflictException("Two step verification is already enabled");
  }

  // generate otp =>  save otp hashed in redis => send email to user with the otp
  const otp = await generateOTP(); //number
  const FAKey = `2FA::ENABLE::${user._id}`;
  await set({
    key: FAKey,
    value: await generateHash({ plaintext: `${otp}` }),
    ttl: 600,
  });

  await sendEmail({
    to: user.email,
    subject: "Two step verification Request",
    html: `<h1>OTP: ${otp}</h1>`,
  });
  return;
};

export const twoFactorEnableConfirm = async (user, inputs) => {
  if (user.twoFactorEnabled) {
    throw ConflictException("Two step verification is already enabled");
  }

  // recieve otp from inputs => get hashed otp from redis => compare hashedotp  => enable two step verification
  const { otp } = inputs;
  const FAKey = `2FA::ENABLE::${user._id}`;

  const hashedOTP = await get(FAKey);
  if (!hashedOTP) {
    throw BadException("Expired OTP!");
  }

  const match = await compareHash({ plaintext: otp, cipherText: hashedOTP });
  if (!match) {
    throw BadException("Invalid OTP!");
  }

  user.twoFactorEnabled = true;
  await user.save();

  await deleteKeys([FAKey]);
  return;
};

// forgot password
export const forgotPassword = async ({ email }) => {
  const user = await dbService.findOne({ model: UserModel, filter: { email } });
  if (!user) {
    throw NotfoundException("Account not found");
  }

  // generate token => save token in redis => send email with link to reset carrying token
  const token = crypto.randomBytes(32).toString("hex"); //32 *2 = 64

  const resetKey = `RESET::PASSWORD::${token}`;
  await set({ key: resetKey, value: user._id, ttl: 300 });

  const resetLink = `${FRONTEND_URL}/reset-password/${token}`;
  await sendEmail({
    to: user.email,
    subject: "Reset password link",
    html: `Click here to reset your password. <br> <a href="${resetLink}" target="_blank">Reset password</a>`,
  });
  return;
};

export const resetPassword = async (token, password) => {
  const resetKey = `RESET::PASSWORD::${token}`;
  const userId = await get(resetKey);
  if (!userId) {
    throw NotfoundException("reset link invalid or expired");
  }

  const user = await dbService.findById({ model: UserModel, id: userId });
  if (!user) {
    throw NotfoundException("User not found");
  }

  await deleteKeys([resetKey]);
  user.password = await generateHash({ plaintext: password });
  user.changeCredentialsTime = new Date();
  await user.save();
  return;
};
