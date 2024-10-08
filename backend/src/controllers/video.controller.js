import mongoose from "mongoose";
import { Video } from "../models/video.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
    deleteVideoFromCloudinary,
    uploadOnCloudinary,
} from "../utils/cloudinary.js";
import { Comment } from "../models/comment.model.js";
import { Playlist } from "../models/playlist.model.js";
import { Like } from "../models/like.model.js";

// todo: check if we need to remove all the unpublished videos
const getAllUsersVideos = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        sortDirec = "desc",
        } = req.query;

    const options = {
        page,
        limit,
    };

    const aggregatePipeline = [
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
            },
        },
        {
            // unwind to access owner fields
            $unwind: "$owner",
        },
        {
            $project: {
                _id: 1,
                videoFile: 1,
                thumbnail: 1,
                title: 1,
                duration: 1,
                views: 1,
                isPublished: 1,
                createdAt: 1,
                updatedAt: 1,

                "owner._id": 1,
                "owner.username": 1,
                "owner.avatar": 1,

            },
        },
    ];

    // sorting
    aggregatePipeline.push({
        $sort: {
            [sortBy]: sortDirec === ("asc" || "ascending") ? 1 : -1,
        },
    });

    const allUserVideos = await Video.aggregatePaginate(
        Video.aggregate(aggregatePipeline),
        options
    );

    if (!allUserVideos) {
        throw new ApiError(
            400,
            "Error while aggregating and paginating all users videos"
        );
    }

    return res
        .status(200)
        .json(
            new ApiResponse(200, allUserVideos, "All users videos fetched successfully")
        );
});

const getAllVideos = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        sortDirec = "desc",
        query,
        userId,
    } = req.query;

    if (!userId) {
        throw new ApiError(400, "User id required");
    }

    const options = {
        page,
        limit,
    };

    // getting all videos of user
    const aggregatePipeline = [
        {
            $match: { owner: new mongoose.Types.ObjectId(userId) },
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
            },
        },
        {
            // unwind to access owner fields
            $unwind: "$owner",
        },
        {
            $project: {
                _id: 1,
                videoFile: 1,
                thumbnail: 1,
                title: 1,
                description: 1,
                duration: 1,
                views: 1,
                isPublished: 1,
                createdAt: 1,
                updatedAt: 1,

                "owner._id": 1,
                "owner.username": 1,
                "owner.avatar": 1,
            },
        },
    ];

    // add query in pipeline if provided
    if (query) {
        aggregatePipeline.push({
            // parse from string to object
            $match: JSON.parse(query),
        });
    }

    // sorting
    aggregatePipeline.push({
        $sort: {
            [sortBy]: sortDirec === ("asc" || "ascending") ? 1 : -1,
        },
    });

    const allVideos = await Video.aggregatePaginate(
        Video.aggregate(aggregatePipeline),
        options
    );

    if (!allVideos) {
        throw new ApiError(
            400,
            "Error while aggregating and paginating all videos of user"
        );
    }

    return res
        .status(200)
        .json(
            new ApiResponse(200, allVideos, "All videos fetched successfully")
        );
});

const publishVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;
    const videoLocalPath = req.file?.path;

    if (!title || !description) {
        throw new ApiError(400, "Title and description both are required");
    }

    if (!videoLocalPath) {
        throw new ApiError(400, "Video required");
    }

    const videoOnCloudinary = await uploadOnCloudinary(videoLocalPath);

    if (!videoOnCloudinary.url) {
        throw new ApiError(400, "Error while uploading video on cloudinary");
    }

    const thumbnailUrl = `${videoOnCloudinary.url.split(".").slice(0, -1).join(".")}.jpg`;

    const video = await Video.create({
        videoFile: videoOnCloudinary.url,
        title,
        description,
        owner: req.user?._id,
        duration: videoOnCloudinary.duration,
        thumbnail: thumbnailUrl,
    });

    return res
        .status(200)
        .json(new ApiResponse(200, video, "Video uploaded successfully"));
});

const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video id is required");
    }

    const video = await Video.findById(videoId)
        .populate({
            path: "owner",
            select: "-password -refreshToken -watchHistory -fullname -email -coverImage",
        })
        .exec();

    if (!video) {
        throw new ApiError(400, "Video id is invalid");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, video, "Video fetched successfully"));
});

const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { title, description } = req.body;

    if (!videoId) {
        throw new ApiError(400, "Video id is required");
    }

    if (!title || !description) {
        throw new ApiError(400, "Title and description both are required");
    }

    const videoLocalUrl = req.file?.path;

    if (!videoLocalUrl) {
        throw new ApiError(400, "Video is required");
    }

    //prev
    const prevVideo = await Video.findById(videoId);

    if (!prevVideo) {
        throw new ApiError(400, "Video id invalid");
    }

    const prevVideoUrl = prevVideo.videoFile;

    // upload
    const videoOnCloudinary = await uploadOnCloudinary(videoLocalUrl);

    if (!videoOnCloudinary) {
        throw new ApiError(400, "Error while uploading video on cloudinary");
    }

    const thumbnailUrl = `${videoOnCloudinary.url.split(".").slice(0, -1).join(".")}.jpg`;

    const video = await Video.findByIdAndUpdate(
        videoId,
        {
            $set: {
                videoFile: videoOnCloudinary.url,
                thumbnail: thumbnailUrl,
                duration: videoOnCloudinary.duration,
                title,
                description,
            },
        },
        { new: true }
    );

    // delete video from cloudinary
    const deletedVideo = await deleteVideoFromCloudinary(prevVideoUrl);

    if (!video) {
        throw new ApiError(400, "Video id is invalid");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                { video, deletedVideo },
                "Video updated successfully"
            )
        );
});

const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video id is required");
    }

    const video = await Video.findByIdAndDelete(videoId);

    if (!video) {
        throw new ApiError(400, "Video id is invalid");
    }

    const deletedVideo = await deleteVideoFromCloudinary(video.videoFile);

    // Delete all related comments
    const deletedComments = await Comment.deleteMany({ video: videoId });

    if (!deletedComments) {
        throw new ApiError(
            500,
            "Error while deleting comments related to Video"
        );
    }

    // Remove the video from all playlists
    const deletedPlaylistVideo = await Playlist.updateMany(
        { videos: videoId },
        {
            $pull: {
                videos: videoId,
            },
        }
    );

    if (!deletedPlaylistVideo) {
        throw new ApiError(
            500,
            "Error while removing deleted video from playlists"
        );
    }
    // Delete all likes related to this video
    const deletedLikes = await Like.deleteMany({ video: videoId });

    if (!deletedLikes) {
        throw new ApiError(
            500,
            "Error while removing likes related to deleted Video"
        );
    }

    if (!deleteVideo) {
        throw new ApiError(400, "Error while deleting video from cloudinary");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(200, { deletedVideo }, "Video deleted successfully")
        );
});

const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    let video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(400, "video not found");
    }

    video.isPublished = !video.isPublished;

    video = await video.save({ validateBeforeSave: false });

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                video,
                "Video publish status toggled successfully"
            )
        );
});

// add Views
const addView = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    let video = await Video.findByIdAndUpdate(
        videoId,
        {
            $inc: { views: 1 },
        },
        { new: true, runValidators: false }
    );

    if (!video) {
        throw new ApiError(400, "error while adding view to video");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                video,
                "Video publish status toggled successfully"
            )
        );
});

export {
    getAllUsersVideos,
    getAllVideos,
    publishVideo,
    togglePublishStatus,
    getVideoById,
    updateVideo,
    deleteVideo,
    addView,
};
