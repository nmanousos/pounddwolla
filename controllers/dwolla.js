var request = require( 'request' )
  , async = require( 'async' )
  , dwolla = require('dwolla')

var User = require("../models/user").User

function analyze ( data, callback ) {
  console.log ( 'analyzing: ' + data.text )
  async.parallel ( 
    {
      amount: function ( callback ) {
        async.detectSeries( data.text.split(' '),
          function( item, callback ) { item.indexOf( '$' ) != -1 ? callback ( true ) : callback ( false ) },
          function( result ) { if( result ) { callback( null, result.slice( 1, result.length ) ) } }
        )        
      },
      to: function ( callback ) {
        async.detectSeries( data.text.split(' ').reverse(),
          function( item, callback ) { item.indexOf( '@' ) != -1 ? callback ( true ) : callback ( false ) },
          function( result ) { if( result ) { callback( null, result.indexOf( ':' ) != -1 ? result.slice( 1, result.length -1 ) : result.slice( 1, result.length ) ) } }
        )        
      },
      to: function ( callback ) {
        async.filter( data.text.split(' '),
          function( item, callback ) { 
          	if( item.indexOf( '@' ) != -1 ) {
          		if(item.indexOf( ':' ) == -1) {        		
	          		callback ( true )
	          	} else {
	          		callback( false )
	          	}
          	} else {
          		callback ( false )
          	}
          },
          function( result ) {   	
          	callback( null, result)
          }
        )        
      }      
    }, 
    function ( err, results ) {
      console.log ( results )
      data.user.screen_name != results.to ? callback( null, results ) : callback( 'cant send to yourself!' )
    }
  )
}

function pay( from, to, amount, data, callback ) {

  from = from.toLowerCase()
  to = to.toLowerCase()
  
  console.log( 'paying ' + to + ' $' + amount + ' from ' + from )
  
  async.parallel( {
    from: function( cb ) { User.findOne ( { username : from }, cb ) },
    to: function( cb ) { User.findOne ( { username : to }, cb ) } 
  },
  function ( err, results ) {
    if ( results.from === null) {
      console.log ('case1 - from user has not signed up')
      if( results.to != null ) {
        var user = new User( )
        user.provider = "twitter"
        user.username = from
        user.payments_outgoing_pending.push( data )
        user.save( function ( err ) {
          if( err ) return console.log( err )
          callback( null, '@' + from + ' thanks for your payment of $' + amount + '! please complete your payment by signing up at pounddwolla.com', results.to, "Pending" )
        } )
      } else {
        callback( 'from and to were both not signed up, so not saving them' )
      }      
    } else if ( typeof results.from.dwolla_pin === 'undefined') {     
      console.log ('case2 - from user has not linked dwolla')
      results.from.payments_outgoing_pending.push( data )
      results.from.save( function ( err ) {
        if( err ) return console.log ( err )
        callback( null, '@' + from + ' thanks for your payment of $' + amount + '! please complete your payment by signing up at pounddwolla.com', results.to, "Pending" )
      } )
    } else if ( results.to === null ) {
      console.log ('case3 - to user has not signed up')      
      var user = new User( )
      user.provider = "twitter"
      user.username = to
      user.payments_incoming_pending.push( data )
      user.save( function ( err ) {
        if( err ) return console.log ( err )
        callback( null, '@' + to + ' payment for $' + amount + ' waiting for you at pounddwolla.com' , results.from, "Pending" )
      } )
    } else if( typeof results.to.dwolla_id === 'undefined' ) {
      console.log ('case4 - to user has not signed up but has payments waiting')
      results.to.payments_incoming_pending.push( data )
      results.to.save( function ( err ) {
        if( err ) return console.log ( err )
        callback( null, '@' + to + ' payment for $' + amount + ' waiting for you at poundwolla.com' , results.from, "Pending" )
      } )
    } else {
      console.log ('case5 - both are signed up - starting payment of ' + amount )
      console.log('results.from.dwolla_token: ' + results.from.dwolla_token)
      console.log('results.from.dwolla_pin: ' + results.from.dwolla_pin)      
      console.log('results.to.dwolla_id: ' + results.to.dwolla_id)            
            
			dwolla.send(results.from.dwolla_token, results.from.dwolla_pin, results.to.dwolla_id, amount, function(err, data) {
				if(err) console.log(err)
				console.log("Transaction ID: ")
				console.log(data);
			});            
            
    }
  }
  )
}

module.exports = {
  Analyze : analyze
  , Pay : pay
}