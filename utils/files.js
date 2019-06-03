/**
 * @author EmmanuelOlaojo
 * @since 11/10/17
 */

let moduleId = "utils/files";

// Max duration of uploaded video in seconds
const MAX_DURATION = 20;

let fs = Promise.promisifyAll(require("fs"));
let mongoose = require("mongoose");
let Fawn = require("fawn");
let ffmpegStatic = require("ffmpeg-static");
let ffprobeStatic = require("ffprobe-static");
let ffmpeg = require("fluent-ffmpeg");
let readChunk = require("read-chunk");
let fileType = require("file-type");

let response = require("./response");
let http = require("./HttpStats");
let Grid = mongoose.mongo.GridFSBucket;

ffmpeg.setFfmpegPath(ffmpegStatic.path);
ffmpeg.setFfprobePath(ffprobeStatic.path);

Fawn.init(mongoose);

/**
 * Checks if a file is an image.
 *
 * @param file - to be checked
 * @returns {Promise.<boolean>}
 */
async function isImage(file){
  let buffer = await readChunk(file.path, 0, 4100);
  let safeTypes = new Set(["jpg", "png", "gif", "webp"]);
  let imgType = fileType(buffer);

  return safeTypes.has(imgType.ext);
}

/**
 * Route handler to get an
 * image with the specified _id
 *
 * @param req the request
 * @param res the response
 *
 * @returns {Promise.<void>}
 */
exports.getImg = async (req, res) => {
  let grid = new Grid(mongoose.connection.db);
  let respondErr = response.failure(res, moduleId);
  let readStream;

  if(!req.query["id"]){
    return respondErr(http.BAD_REQUEST, "Missing required id");
  }

  let _id = mongoose.Types.ObjectId(req.query.id);
  let file = (await grid.find({_id}).toArray())[0];
  let mimeType = file.metadata ? file.metadata.mimetype : "image/png";

  readStream = grid.openDownloadStream(_id);

  readStream.on("error", err => {
    respondErr(http.BAD_REQUEST, err.message);
  });

  res.set("Content-Type", mimeType);
  readStream.pipe(res);
};

async function uploadFile(file, metadata){
  let grid = new Grid(mongoose.connection.db);

  try {
    let readStream = fs.createReadStream(file.path);
    let writeStream = grid.openUploadStream(file.filename, {metadata});
    let _id = writeStream.id;

    return await new Promise(function (resolve, reject) {
      writeStream.once("finish", async () => {
        let savedFile = (await grid.find({_id}).toArray())[0];

        fs.unlink(file.path, err => {
          if(err) return reject(err);

          resolve(savedFile);
        });
      });

      writeStream.on("error", reject);
      readStream.on("error", reject);

      readStream.pipe(writeStream);
    });
  }
  catch(err){
    throw err;
  }
}

/**
 * Uploads an image to the db. Returns
 * null if the provided file is not an image
 *
 * @param file - to be uploaded
 * @returns {Promise.<*>}
 */
let uploadImage = exports.uploadImage = async (file) => {
  let result = null;
  let imageErr = null;

  try{
    let isImg = await isImage(file);

    if(isImg){
      result = await uploadFile(file, file);
    }
    else{
      imageErr = new Error("Invalid Image");
      await fs.unlinkAsync(file.path);
    }
  }
  catch(err){
    throw err;
  }

  if (imageErr) throw imageErr;

  return result;
};

/**
 * Uploads images to the db.
 *
 * @param files - to be uploaded
 * @returns {Promise.<*>}
 */
exports.uploadImages = async files => {
  let result = [];
  let res;

  for(let file of files){
    try{
      res = await uploadImage(file);

      if (res) result.push(res);
    }
    catch(err){}// invalid image = do nothing
  }

  return result;
};

/**
 * Stores the path to an mp4 version of a
 * video file in file.mp4 and resolves with the
 * file.
 *
 * @returns {Promise.<*>}
 */
let toMp4 = exports.toMp4 = (file, maxDuration = MAX_DURATION) => {
  let mpeg = ffmpeg(file.path);
  let filePath = `${file.path}.mp4`;

  return new Promise(function(resolve, reject){
    mpeg.ffprobe((err, data) => {
      if(err) return reject(err);

      if(data.format.duration > maxDuration){
        let error = {
          message: `Video too long. Max duration is ${maxDuration} seconds`
        };

        error.type = "LongVideo";
        return reject(error);
      }

      let codec = data.streams[0].codec_name;

      if(codec === "h264"){
        return resolve(file);
      }

      mpeg.format("mp4")
        .outputOptions("-preset ultrafast")
        .on("error", reject)
        .on("end", async () => {
          try{
            console.log("done");
            await fs.unlink(file.path);

            file.path = filePath;
            file.poster = poster;

            console.log("file:", file, file.poster);

            resolve(file);
          }
          catch(err){
            console.log(err);
            reject(err);
          }
        })
        .save(filePath);
    });
  });
};

let savePoster = async (file) => {
  let mpeg = ffmpeg(file.path);
  let poster = {
    filename: `${file.filename}.png`,
    path: `./temp/${file.filename}.png`
  };

  return new Promise((resolve, reject) => {
    mpeg = mpeg
      .on("error", reject)
      .on('end', async function() {
        try{
          poster = await uploadImage(poster);
          resolve(poster);
        }
        catch(err){
          reject(err);
        }
      });

    mpeg.screenshots({
      folder: "./temp",
      filename: poster.filename,
      timestamps: ["25%"],
      count: 1
    });
  });
};

/**
 * Takes a video that's not longer than
 * maxDuration and uploads it to the db as
 * an mp4.
 *
 * @param file the video file object
 * @param maxDuration max duration for a video in seconds
 *
 * @returns {Promise.<*>}
 */
let uploadVideo = exports.uploadVideo = async (file, maxDuration = MAX_DURATION) => {
  let vid;

  try {
    vid = await toMp4(file, maxDuration);

    console.log(vid);
    vid.poster = await savePoster(vid);

    return await uploadFile(vid, vid);
  }
  catch(err){
    try{
      let f = vid || file;

      if(vid){
        await fs.unlinkAsync(f.poster.path);
      }

      await fs.unlinkAsync(f.path);
    } catch (unlinkErr){}

    throw err;
  }
};

exports.uploadVideos = async (files, maxDuration) => {
  let result = [];
  let res;

  for(let file of files){
    try{
      res = await uploadVideo(file, maxDuration);

      console.log(res);

      if (res) result.push(res);
    }
    catch(err){
      console.log(err);
    }// invalid video = do nothing
  }

  return result;
};

/**
 * Route handler for streaming files. This function
 * responds with a range of bytes from a file
 * or with the whole file if no range is specified.
 * It responds with partial content (206)
 *
 * @param req the request
 * @param res the response
 * @returns {Promise.<*>}
 */
exports.stream = async (req, res) => {
  let respondErr = response.failure(res, moduleId);
  let _id = mongoose.Types.ObjectId(req.query.id);
  let grid = new Grid(mongoose.connection.db);

  try{
    let fileArr = await grid.find({_id}).toArray();

    if (!fileArr.length) {return respondErr(http.NOT_FOUND, "File not found");}

    let file = fileArr[0];
    let mimeType = file.metadata ? file.metadata.mimetype : "video/mp4";
    let byteRange = req.range(file.length);

    if (byteRange === -1) {
      return respondErr(http.UNSATISFIABLE_RANGE, "Invalid Range");
    }

    res.set("Content-Type", mimeType);
    res.set("Accept-Ranges", "bytes");
    res.status(http.PARTIAL_CONTENT);

    if (byteRange === -2 || byteRange === undefined) {
      res.set("Content-Length", `${file.length}`);
      return grid.openDownloadStream(_id).pipe(res);
    }

    if(byteRange.type !== "bytes"){
      return respondErr(http.UNSATISFIABLE_RANGE, "Bytes only, please!!");
    }

    byteRange = byteRange.shift();

    let readStream = grid.openDownloadStream(_id, {
      start: byteRange.start,
      end: byteRange.end
    });

    res.set({
      "Content_Length": (byteRange.end - byteRange.start) + 1,
      "Content-Range": `bytes ${byteRange.start}-${byteRange.end}/${file.length}`
    });

    readStream.pipe(res);
  }
  catch(err){
    respondErr(http.SERVER_ERROR, err.message, err);
  }
};
