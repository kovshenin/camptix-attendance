var camptix = camptix || {};

(function($){
	$(document).ready(function(){

		camptix.models = camptix.models || {};
		camptix.views = camptix.views || {};
		camptix.collections = camptix.collections || {};
		camptix.ajax = camptix.ajax || {};

		camptix.ajax.send = function( action, options ) {
			if ( _.isObject( action ) ) {
				options = action;
			} else {
				options = options || {};
				options.data = _.extend( options.data || {}, { action: action });
			}

			options = _.defaults( options || {}, {
				type:    'POST',
				url:     wp.ajax.settings.url,
				context: this
			});

			return $.Deferred( function( deferred ) {
				var xhr;

				// Transfer success/error callbacks.
				if ( options.success )
					deferred.done( options.success );
				if ( options.error )
					deferred.fail( options.error );

				delete options.success;
				delete options.error;

				// Use with PHP's wp_send_json_success() and wp_send_json_error()
				options.xhr = $.ajax( options ).done( function( response ) {
					// Treat a response of `1` as successful for backwards
					// compatibility with existing handlers.
					if ( response === '1' || response === 1 )
						response = { success: true };

					if ( _.isObject( response ) && ! _.isUndefined( response.success ) )
						deferred[ response.success ? 'resolveWith' : 'rejectWith' ]( this, [response.data] );
					else
						deferred.rejectWith( this, [response] );
				}).fail( function() {
					deferred.rejectWith( this, arguments );
				});

			}).promise();
		}

		camptix.models.Attendee = Backbone.Model.extend({
			defaults: function() {
				return {
					status: false,
					avatar: '',
					name: '',
				}
			},

			toggle: function( attended ) {
				this.save({ status: attended });
			},

			sync: function( method, model, options ) {
				var model = this;
				model.trigger( 'camptix:sync:start' );

				options = options || {};
				options.context = this;
				options.type = 'GET';

				options.data = _.extend( options.data || {}, {
					action: 'camptix-attendance',
					camptix_secret: _camptixAttendanceSecret
				});

				if ( method == 'read' ) {
					options.data = _.extend( options.data || {}, {
						camptix_action: 'sync-model',
						camptix_id: this.id
					});

					return wp.ajax.send( options ).done( function() { model.trigger( 'camptix:sync:end' ); } );

				} else if ( method == 'update' ) {
					options.data = _.extend( options.data || {}, {
						camptix_action: 'sync-model',
						camptix_set_attendance: this.get( 'status' ),
						camptix_id: this.id
					});

					return wp.ajax.send( options ).done( function() { model.trigger( 'camptix:sync:end' ) } );
				}
			}
		});

		camptix.collections.AttendeesList = Backbone.Collection.extend({

			model: camptix.models.Attendee,

			initialize: function( models, options ) {
				this._hasMore = true;
				this.query = options.query;
				this.controller = options.controller;
			},

			sync: function( method, model, options ) {
				var xhr, promise, controller;

				controller = this.controller;

				if ( method == 'read' ) {
					options = options || {};
					options.context = this;
					options.type = 'GET';
					options.data = _.extend( options.data || {}, {
						action: 'camptix-attendance',

						camptix_action: 'sync-list',
						camptix_paged: Math.floor( this.length / 50 ) + 1,
						camptix_secret: _camptixAttendanceSecret
					});

					if ( this.query.search )
						options.data.camptix_search = this.query.search;

					if ( this.query.filters )
						options.data.camptix_filters = this.query.filters;

					promise = camptix.ajax.send( options );

					// Cancel any previous sync requests.
					_.each( this.controller.requests, function( req, index ) {
						req.abort();
					});

					this.controller.requests = [];
					this.controller.requests.push( options.xhr );
					return promise;
				}
			},

			hasMore: function() {
				return this._hasMore;
			},

			more: function( options ) {
				var that = this;

				if ( ! this.hasMore() ) {
					return $.Deferred().resolveWith( this ).promise();
				}

				if ( this._more && 'pending' === this._more.state() ) {
					return this._more;
				}

				return this._more = this.fetch({ remove: false }).done( function( resp ) {
					if ( _.isEmpty( resp ) || resp.length < 50 ) {
						that._hasMore = false;
						this.controller.trigger( 'more:toggle', this._hasMore );
					}
				});
			}
		});

		camptix.views.AttendeeView = Backbone.View.extend({
			tagName: 'li',
			className: 'item',

			template: wp.template( 'attendee' ),

			events: {
				'fastClick': 'toggle'
			},

			initialize: function( options ) {
				this.controller = options.controller;

				this.listenTo( this.model, 'change', this.render );
				this.listenTo( this.model, 'destroy', this.remove );
				this.listenTo( this.model, 'camptix:sync:start', this.syncStart );
				this.listenTo( this.model, 'camptix:sync:end', this.syncEnd );
			},

			render: function() {
				this.$el.html( this.template( this.model.toJSON() ) );
				return this;
			},

			syncStart: function() {
				this.$el.toggleClass( 'camptix-loading', true );
			},
			
			syncEnd: function() {
				this.$el.toggleClass( 'camptix-loading', false );
			},

			toggle: function() {
				// This touch was to stop a scroll.
				if ( +new Date() - this.controller.lastScroll < 200 )
					return;

				var toggleView = new camptix.views.AttendeeToggleView({ model: this.model, controller: this.controller });
				$(document.body).append( toggleView.render().el );
			}
		});

		camptix.views.AttendeeToggleView = Backbone.View.extend({
			className: 'attendee-toggle-wrap',

			template: wp.template( 'attendee-toggle' ),

			events: {
				'fastClick .yes': 'yes',
				'fastClick .no': 'no',
				'fastClick .close': 'close'
			},

			initialize: function( options ) {
				this.controller = options.controller;
				this.$overlay = $('.overlay');
			},

			render: function() {
				this.$el.html( this.template( this.model.toJSON() ) );
				this.$overlay.show();
				return this;
			},

			yes: function() {
				this.controller.trigger( 'flush' );
				this.model.toggle( true );
				return this.close();
			},

			no: function() {
				this.controller.trigger( 'flush' );
				this.model.toggle( false );
				return this.close();
			},

			close: function() {
				this.$overlay.hide();
				this.remove();
				return false;
			}
		});

		camptix.views.AttendeeSearchView = Backbone.View.extend({
			className: 'attendee-search-view',
			template: wp.template( 'attendee-search' ),

			events: {
				'input input':  'search',
				'keyup input':  'search',
				'change input': 'search',
				'search input': 'search',
				'fastClick .close': 'close'
			},

			initialize: function( options ) {
				if ( options && options.controller ) {
					this.controller = options.controller;
				}

				this.search = _.debounce( this.search, 500 );
			},

			render: function() {
				this.$el.html( this.template() );
				return this;
			},

			search: function( event ) {
				if ( event.keyCode == 13 ) {
					this.$el.find( 'input' ).blur();
				}

				var keyword = event.target.value || '';
				this.controller.trigger( 'search', keyword );
			},

			close: function() {
				this.controller.trigger( 'search', '' );
				this.remove();
			}
		});

		camptix.views.AttendeeFilterView = Backbone.View.extend({
			className: 'attendee-filter-view',
			template: wp.template( 'attendee-filter' ),

			events: {
				'fastClick .close': 'close',
				'fastClick .filter-attendance li': 'toggleAttendance',
				'fastClick .filter-tickets li': 'toggleTickets'
			},

			initialize: function( options ) {
				this.controller = options.controller;
				this.filterSettings = options.filterSettings || {};
			},

			render: function() {
				this.$el.html( this.template( this.filterSettings ) );
				return this;
			},

			close: function() {
				this.remove();
			},

			toggleAttendance: function( event ) {
				var selection = $( event.target ).data( 'attendance' );
				this.filterSettings.attendance = selection;
				this.render();

				this.controller.trigger( 'filter', this.filterSettings );
			},

			toggleTickets: function( event ) {
				var ticket_id = $( event.target ).data( 'ticket-id' );

				if ( _.contains( this.filterSettings.tickets, ticket_id ) ) {
					this.filterSettings.tickets = _.without( this.filterSettings.tickets, ticket_id );
				} else {
					this.filterSettings.tickets.push( ticket_id );
				}

				this.render();
				this.controller.trigger( 'filter', this.filterSettings );
			},
		});

		camptix.views.Application = Backbone.View.extend({
			template: wp.template( 'application' ),

			events: {
				'fastClick .dashicons-menu': 'menu',
				'fastClick .submenu .search': 'searchView',
				'fastClick .submenu .refresh': 'refresh',
				'fastClick .submenu .filter': 'filterView'
			},

			initialize: function() {
				this.cache = [];
				this.query = {};
				this.requests = [];
				this.lastScroll = 0;

				this.filterSettings = {
					'attendance': 'none',
					'tickets': _camptixAttendanceTickets,
					'search': ''
				};

				this.render();

				this.$header = this.$el.find( 'header' );
				this.$menu = this.$header.find( '.menu' );

				this.scroll = _.chain( this.scroll ).bind( this ).value();
				this.$list = this.$el.find( '.attendees-list' );
				this.$list.on( 'scroll', this.scroll );
				this.$loading = this.$list.find( '.loading' );

				this.on( 'search', this.search, this );
				this.on( 'flush', this.flush, this );
				this.on( 'more:toggle', this.moreToggle, this );
				this.on( 'filter', this.filter, this );

				this.setupCollection();
			},

			moreToggle: function( hasMore ) {
				this.$loading.toggle( hasMore );
			},

			setupCollection: function( query ) {
				var collection,
					options = {};

				// Dispose of the current collection and cache it for later use.
				if ( 'undefined' != typeof this.collection ) {
					this.collection.off( null, null, this );
					this.cache.push( this.collection );
				}

				query = _.defaults( query || {}, {
					search: '',
					filters: _.clone( this.filterSettings )
				});

				options.query = query;
				options.controller = this;

				collection = _.find( this.cache, function( collection ) {
					return _.isEqual( collection.query, options.query );
				} );

				if ( ! collection ) {
					collection = new camptix.collections.AttendeesList( [], options );
				}

				this.query = query;
				this.collection = collection;
				this.collection.on( 'add', this.add, this );
				this.collection.on( 'reset', this.reset, this );

				// Clear the list before adding things back.
				this.$list.find( 'li.item' ).remove();

				if ( this.collection.length ) {
					this.collection.trigger( 'reset' );
				} else {
					this.collection.more().done( this.scroll );
				}

				this.trigger( 'more:toggle', collection.hasMore() );
			},

			scroll: function() {
				var view = this,
					el = this.$list[0];

				this.lastScroll = +new Date();

				if ( ! this.collection.hasMore() )
					return;

				if ( el.scrollHeight < el.scrollTop + ( el.clientHeight * 3 ) ) {
					this.collection.more().done(function() {
						view.scroll();
					});
				}
			},

			render: function() {
				this.$el.html( this.template() );
				$(document.body).append( this.el );
				return this;
			},

			add: function( item ) {
				var view = new camptix.views.AttendeeView({ model: item, controller: this });
				this.$loading.before( view.render().el );
			},

			reset: function() {
				// console.log( this.collection );
				this.collection.each( this.add, this );
			},

			menu: function( event ) {
				this.$menu.toggleClass( 'dropdown' );
			},

			searchView: function() {
				this.$menu.removeClass( 'dropdown' );
				this.searchView = new camptix.views.AttendeeSearchView({ controller: this });
				this.$header.append( this.searchView.render().el );

				this.searchView.$el.find('input').focus();
				return false;
			},

			filterView: function() {
				this.$menu.removeClass( 'dropdown' );
				this.filterView = new camptix.views.AttendeeFilterView({ controller: this, filterSettings: this.filterSettings });
				this.$el.append( this.filterView.render().el );
				return false;
			},

			refresh: function() {
				this.$menu.removeClass( 'dropdown' );
				delete this.collection;
				this.flush();
				this.setupCollection();
				return false;
			},

			search: function( keyword ) {
				this.keyword = this.keyword || '';
				if ( keyword == this.keyword )
					return;

				this.keyword = keyword;
				this.setupCollection({ search: this.keyword });
			},

			filter: function( settings ) {
				this.filterSettings = settings;
				delete this.collection;
				this.flush();
				this.setupCollection();
			},

			flush: function() {
				this.cache = [];
			}
		});

		camptix.app = new camptix.views.Application();
	});
})(jQuery);