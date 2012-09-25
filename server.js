var express = require( 'express' )
  , mongoose = require( 'mongoose' )
  , request = require( 'request' )
  , async = require( 'async' )
  , twitter = require( 'ntwitter' )
  , immortalNtwitter = require( 'immortal-ntwitter' ) 
  , passport = require( 'passport')
  , DwollaStrategy = require( 'passport-dwolla' ).Strategy
  , TwitterStrategy = require( 'passport-twitter' ).Strategy
  , Schema = mongoose.Schema
  , PORT = (process.env.PORT || 3000 )
  , MONGO_URL = 'mongo_url'

	, DWOLLA_KEY = 'key'
	, DWOLLA_SECRET ='secret'

  , TWITTER_CONSUMER_KEY = ( process.env.NODE_ENV ? 'prod' : 'dev' ) 
  , TWITTER_CONSUMER_SECRET = ( process.env.NODE_ENV ? 'prod' : 'dev' ) 
  , TWITTER_ACCESS_TOKEN_KEY = ( process.env.NODE_ENV ? 'prod' : 'dev' ) 
  , TWITTER_ACCESS_TOKEN_SECRET = ( process.env.NODE_ENV ? 'prod' : 'dev' ) 

  , TWITTER_CALLBACK = ( process.env.NODE_ENV ? 'http://pounddwolla.com/auth/twitter/callback' : 'http://127.0.0.1:3000/auth/twitter/callback' ) 
	, DWOLLA_CALLBACK = ( process.env.NODE_ENV ? 'http://pounddwolla.com/auth/dwolla/callback' : 'http://127.0.0.1:3000/auth/dwolla/callback' )   
	
	, STATUS_FILTER = ( process.env.NODE_ENV ? '#dwolla' : '#dwolla_dev' )   

mongoose.connect( MONGO_URL )
var User = require("./models/user").User

var Analyze = require('./controllers/dwolla').Analyze
var Pay = require('./controllers/dwolla').Pay

var twit = immortalNtwitter.create ( {
  consumer_key : TWITTER_CONSUMER_KEY
  , consumer_secret : TWITTER_CONSUMER_SECRET
  , access_token_key : TWITTER_ACCESS_TOKEN_KEY
  , access_token_secret : TWITTER_ACCESS_TOKEN_SECRET
} )

twit.immortalStream( 'statuses/filter', { 'track' : STATUS_FILTER } ,
  function ( stream ) {
    stream.on( 'data', function ( data ) {
			console.log(data.text)    	
			io.sockets.emit('tweet', data)
			Analyze( data, function ( err, results ) {
				if ( err ) return console.log ( err )
				async.forEach(results.to,	
					function(to_user, cb){
						Pay( data.user.screen_name, to_user.slice(1,to_user.length) , results.amount, data, function ( err, msg, from, status ){ 
							if( err ) {
								return console.log ( err )
								cb(err)
							}
							tweetUser( msg, from )
							cb(null)
						} )
					},
					function(err){
						if(err) {
							console.log(err)
						} else {
							console.log('done iterating through payment array')
						}
					}
				)
			})
    } )
    stream.on( 'error', function ( err, data ) {
      console.log ( err )
      console.log ( data )
    } )    
  }
)

function tweetUser ( status, user ) {
  	console.log('tweetUser: ' )
  	console.log(status )
  	console.log(user)

  if( user != null ) {
    var twitUser = new twitter ( {
      access_token_key : user.token
      , access_token_secret : user.token_secret
    } )
    twitUser.updateStatus( status, 
      function (err, data) {
        if( err ) return console.log ( err )
        console.log( user.username + ' tweeted: ' + data.text)
      }
    )
  }
}

passport.use(new DwollaStrategy({
    clientID: DWOLLA_KEY,
    clientSecret: DWOLLA_SECRET,
    callbackURL: DWOLLA_CALLBACK
  },
  function(accessToken, refreshToken, profile, done) {
  	profile.accessToken = accessToken
  	console.log(profile)  	 
  	return done(null, profile)
  }
))

passport.use( new TwitterStrategy( {
    consumerKey : TWITTER_CONSUMER_KEY
    , consumerSecret : TWITTER_CONSUMER_SECRET
    , callbackURL : TWITTER_CALLBACK
  } ,
  function ( token, tokenSecret, profile, done ) {
    profile.username = profile.username.toLowerCase()
    //console.log( profile )
    User.findOne ( { username : profile.username }, function ( err, user ) {
      if( err ) { return done ( err ) }
      if( user ) { 
        user.token = token
        user.token_secret = tokenSecret
        user.save( function ( err ) {
          if( err ) throw err
          done( null, user )
        } )
      } else {
        var user = new User( )
        user.provider = "twitter"
        user.uid = profile.id
        user.token = token
        user.token_secret = tokenSecret
        user.username = profile.username.toLowerCase()        
        user.profile_image_url = profile._json.profile_image_url
        user.save( function ( err ) {
          if( err ) throw err
          done( null, user )
        } )
      }
    } )
  }
) )

passport.serializeUser( function ( user, done ) {
  done( null, user.username )
} )

passport.deserializeUser( function ( username, done ) {
  User.findOne( { username: username }, done )
} )

var server = express.createServer( )

server.configure(function( ) {
  server.set( 'views' , __dirname + '/views' )
  server.set( 'view engine', 'ejs' )
  //server.use( express.logger( ) )
  server.use( express.cookieParser( ) )
  server.use( express.bodyParser( ) )
  server.use( express.methodOverride( ) )
  server.use( express.session( { secret : 'kljl332lkj2kj2nncn!!!lkjkj@@' } ) )
  server.use( passport.initialize( ) )
  server.use( passport.session( ) )
  server.use( server.router )
  server.use( express.static( __dirname + '/static' ) )
} )

server.configure('production', function(){
  server.use(express.errorHandler({ dumpExceptions: true, showStack: true }))
})

var io = require('socket.io').listen(server);
io.set('log level', 1); // reduce logging

server.get('/test123', function(req, res){
	io.sockets.emit('tweet', { message: "test123" });
	console.log('test123')
	res.send(200)
})

server.get('/rate', function(req, res){
	twit.rateLimitStatus(function (err, data) {
		res.send(data)
	})
})

server.get('/auth/dwolla',
  passport.authorize('dwolla', { scope: 'AccountInfoFull|Send' }),
  function(req, res){
    // The request will be redirected to Dwolla for authentication, so this function will not be called.
  })

server.get('/auth/dwolla/callback', 
  passport.authorize('dwolla', { failureRedirect: '/failure' }),
  function(req, res) {
  	console.log('/auth/dwolla/callback')
  	console.log(req.account)
  	
    User.findOne ( { username : req.user.username }, function ( err, user ) {
      if( err ) { return done ( err ) }
      if( user ) { 
        user.dwolla_token = req.account.accessToken
        user.dwolla_id = req.account.id
        user.save( function ( err ) {
          if( err ) throw err
					res.redirect( '/' )
        } )
      }
    }
  )

})

server.post( '/pin', function(req, res) {

	console.log(req.user)

    User.findOne ( { username : req.user.username }, function ( err, user ) {
      if( err ) { return done ( err ) }
      if( user ) { 
      	console.log('found user: ' + req.user.username + ', saving pin: ' + req.body.pin )

        user.dwolla_pin = req.body.pin
        req.user.dwolla_pin = req.body.pin
        user.save( function ( err ) {
          if( err ) throw err
          
						if( user.payments_incoming_pending.length > 0 ) {
              console.log ( 'user has pending incoming payments!!! '+ user.payments_incoming_pending.length )            
              async.forEachSeries( user.payments_incoming_pending, 
                function(data, cb){
                  Analyze( data, function ( err, results ) {
                    if ( err ) console.log ( err )


										async.forEach(results.to,	
											function(to_user, cb){
												Pay( data.user.screen_name, to_user.slice(1,to_user.length) , results.amount, data, function ( err, msg, from, status ){ 
													if( err ) {
														return console.log ( err )
														cb(err)
													}
													tweetUser( msg, from )
													cb(null)
												} )
											},
											function(err){
												if(err) {
													console.log(err)
												} else {
													console.log('done iterating through payment array')
												}
											}
										)

                   
                  } )
                },
                function (err) {
                  if ( err ) console.log ( err )
                  console.log ( 'done with pending incoming payments' )
                  user.payments_incoming_pending = []
                  user.save( function ( err ) {
                    if( err ) throw err
                    //console.log ( user )
                  } )
                }
              )
            }

            if( user.payments_outgoing_pending.length > 0 ) {
              console.log ( 'user has pending outgoing payments!!! '+ user.payments_outgoing_pending.length )            
              async.forEachSeries( user.payments_outgoing_pending, 
                function(data, cb){
                  Analyze( data, function ( err, results ) {
                    if ( err ) console.log ( err )
										async.forEach(results.to,	
											function(to_user, cb){
												Pay( data.user.screen_name, to_user.slice(1,to_user.length) , results.amount, data, function ( err, msg, from, status ){ 
													if( err ) {
														return console.log ( err )
														cb(err)
													}
													tweetUser( msg, from )
													cb(null)
												} )
											},
											function(err){
												if(err) {
													console.log(err)
												} else {
													console.log('done iterating through payment array')
												}
											}
										)
                  
                  } )
                },
                function (err) {
                  if ( err ) console.log ( err )
                  console.log ( 'done with pending outgoing payments' )
                  user.payments_outgoing_pending = []
                  user.save( function ( err ) {
                    if( err ) throw err
                    //console.log ( user )
                  } )
                }
              )
            }           
          
          res.render( 'index', { user : req.user, isAuthenticated: req.isAuthenticated() } )
        } )
      }
    })

	
})

server.get( '/auth/twitter' ,
  passport.authenticate( 'twitter' ) ,
  function( req, res ) { }
)

server.get( '/auth/twitter/callback' ,
  passport.authenticate( 'twitter', { failureRedirect : '/' } ) ,
  function ( req, res ) {
  	console.log('/auth/twitter/callback')
  	console.log(req.user)
    if( typeof req.user.dwolla_token != 'undefined' ) {
      console.log ( 'dwolla token exists' )
      res.redirect( '/' )
    } else {
      console.log ( 'no dwolla token - redirecting to dwolla' )
      res.redirect( '/auth/dwolla' )
    }
  }
)

server.get( '/logout' , function( req, res ) {
  req.logout( )
  res.redirect( '/' )
} )

server.get( '/', function ( req, res ) {
	if(req.headers.host == 'www.pounddwolla.com') {
		res.redirect('http://pounddwolla.com/')
	} else {
  	res.render( 'index', { user : req.user, isAuthenticated: req.isAuthenticated() } )
	}
} )

server.listen( PORT )

function ensureAuthenticated( req, res, next ) {
	console.log('ensureAuthenticated')
  if( req.isAuthenticated() ) return next()
  res.redirect( '/auth/twitter' )
}
