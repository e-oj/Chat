/**
 * @author EmmanuelOlaojo
 * @since 12/20/17
 */

let path = require("path");
let express = require("express");
let logger = require("morgan");
let bodyParser = require("body-parser");
let mongoose = require("mongoose");
let bluebird = require("bluebird");
let cors = require("cors");
let helmet = require("helmet");
let compression = require("compression");
let passport = require("passport");
let session = require("express-session");

mongoose.Promise = global.Promise = bluebird;

let config = require("./config");
let api = require("./app");

mongoose.set("useCreateIndex", true);
mongoose.connect(config.DB_URL, config.DB_OPTIONS);

const STATIC = path.join(__dirname, "view", "dist");
let app = express();

app.disable('etag');
app.use(helmet());

app.use(compression({level: 6})); // Default compression level is 6
app.use(express.static(STATIC));

app.use(logger("dev"));
app.use(bodyParser.json({limit: config.MAX_PAYLOAD}));
app.use(bodyParser.urlencoded({extended: true}));
app.use(cors());

app.use(session({
  resave: false,
  saveUninitialized: false,
  secret: config.SECRET
}));

app.use(passport.initialize());
app.use(passport.session());

app.use("/api", api);

app.use("*", (req, res) => {
  res.sendFile(`${STATIC}/index.html`);
});

// start https or http server
startServer();

/**
 * Starts a development or production
 * server with http or https.
 */
function startServer(){
  const {PORT} = config;
  let server;

  if(process.env.NODE_ENV === "production"){
    server = prodServer(PORT);
  }
  else {
    server = devServer(PORT);
  }

  server.on("close", async err => {
    if(err) throw err;

    console.log("\nClosing db connections...\n");
    try{
      await mongoose.disconnect();
    }
    catch (e) {
      console.error(e.message)
    }
    console.log("Server Out!! *drops mic*");
  });

  process.on("SIGINT", () => server.close());

  console.log(`Running on port: ${PORT}`);
}

/**
 * Starts an https server at
 * the given port
 *
 * @param port - port number
 * @return {Server}
 */
function prodServer(port){
  let https = require("https");

  let options = {
    key: config.KEY,
    cert: config.CERT
  };

  return https.createServer(options, app).listen(port)
}

/**
 * Starts an http or, if the env vars
 * are present, https server at the
 * given port.
 *
 * @param port - port number
 * @return {*}
 */
function devServer(port){
  if(config.CERT && config.KEY){
    return prodServer(port);
  }

  return app.listen(port);
}