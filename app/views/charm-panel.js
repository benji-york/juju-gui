'use strict';

/**
 * The charm panel views implement the various things shown in the right panel
 * when clicking on the "Charms" label in the title bar, or running a search.
 *
 * @module views
 * @submodule views.charm-panel
 */

YUI.add('juju-charm-panel', function(Y) {

  var views = Y.namespace('juju.views'),
      utils = Y.namespace('juju.views.utils'),
      models = Y.namespace('juju.models'),
      // This will hold objects that can be used to detach the subscriptions
      // when the charm panel is destroyed.
      subscriptions = [],
      // Singleton
      _instance,

      // See https://github.com/yui/yuidoc/issues/25 for issue tracking
      // missing @function tag.
      /**
       * A shared listener for click events on headers that open and close
       * associated divs.
       *
       * It expects the event target to contain an i tag used as a bootstrap
       * icon, and to have a parent with the 'charm-section' class.  The parent
       * must contain an element with the 'collapsible' class.  The i switches
       * back and forth between up and down icons, and the collapsible element
       * opens and closes.
       *
       * @method toggleSectionVisibility
       * @static
       * @private
       * @return {undefined} Mutates only.
       */
      toggleSectionVisibility = function(ev) {
        var el = ev.currentTarget.ancestor('.charm-section')
                .one('.collapsible'),
            icon = ev.currentTarget.one('i');
        // clientHeight and offsetHeight are not as reliable in tests.
        if (parseInt(el.getStyle('height'), 10) === 0) {
          el.show('sizeIn', {duration: 0.25, width: null});
          icon.replaceClass('chevron_down', 'chevron_up');
        } else {
          el.hide('sizeOut', {duration: 0.25, width: null});
          icon.replaceClass('chevron_up', 'chevron_down');
        }
      },

      /**
       * Given a container node and a total height available, set the height of
       * a '.charm-panel' node to fill the remaining height available to it
       * within the container.  This expects '.charm-panel' node to possibly
       * have siblings before it, but not any siblings after it.
       *
       * @method setScroll
       * @static
       * @private
       * @return {undefined} Mutates only.
       */
      setScroll = function(container, height) {
        var scrollContainer = container.one('.charm-panel');
        if (scrollContainer && height) {
          var diff = scrollContainer.getY() - container.getY(),
              clientDiff = (
              scrollContainer.get('clientHeight') -
              parseInt(scrollContainer.getComputedStyle('height'), 10)),
              scrollHeight = height - diff - clientDiff - 1;
          scrollContainer.setStyle('height', scrollHeight + 'px');
        }
      },

      /**
       * Given a set of entries as returned by the charm store "find"
       * method (charms grouped by series), return the list filtered
       * by 'filter'.
       *
       * @method filterEntries
       * @static
       * @private
       * @param {Array} entries An ordered collection of groups of charms, as
       *   returned by the charm store "find" method.
       * @param {String} filter Either 'all', 'subordinates', or 'deployed'.
       * @param {Object} services The db.services model list.
       * @return {Array} A filtered, grouped set of entries.
       */
      filterEntries = function(entries, filter, services) {
        var deployedCharms;

        /**
         * Filter to determine if a charm is a subordinate.
         *
         * @method isSubFilter
         * @param {Object} charm The charm to test.
         * @return {Boolean} True if the charm is a subordinate.
         */
        function isSubFilter(charm) {
          return !!charm.get('is_subordinate');
        }

        /**
         * Filter to determine if a charm is the same as any
         * deployed services.
         *
         * @method isDeployedFilter
         * @param {Object} charm The charm to test.
         * @return {Boolean} True if the charm matches a deployed service.
         */
        function isDeployedFilter(charm) {
              return deployedCharms.indexOf(charm.get('id')) !== -1;
        }

        var filter_fcn;

        if (filter === 'all') {
          return entries;
        } else if (filter === 'subordinates') {
          filter_fcn = isSubFilter;
        } else if (filter === 'deployed') {
          filter_fcn = isDeployedFilter;
          if (!Y.Lang.isValue(services)) {
            deployedCharms = [];
          } else {
            deployedCharms = services.get('charm');
          }
        } else {
          // This case should not happen.
          return entries;
        }

        var filtered = Y.clone(entries);
        // Filter the charms based on the filter function.
        filtered.forEach(function(series_group) {
          series_group.charms = series_group.charms.filter(filter_fcn);
        });
        // Filter the series group based on the existence of any
        // filtered charms.
        return filtered.filter(function(series_group) {
          return series_group.charms.length > 0;
        });
      },

      /**
       * Given a set of grouped entries as returned by the charm store "find"
       * method, return the same data but with the charms converted into data
       * objects that are more amenable to rendering with handlebars.
       *
       * @method makeRenderableResults
       * @static
       * @private
       * @param {Array} entries An ordered collection of groups of charms, as
       *   returned by the charm store "find" method.
       * @return {Array} An ordered collection of groups of charm data.
       */
      makeRenderableResults = function(entries) {
        return entries.map(
            function(data) {
              return {
                series: data.series,
                charms: data.charms.map(
                    function(charm) { return charm.getAttrs(); })
              };
            });
      },

      /**
       * Given an array of interface data as stored in a charm's "required"
       * and "provided" attributes, return an array of interface names.
       *
       * @method getInterfaces
       * @static
       * @private
       * @param {Array} data A collection of interfaces as stored in a charm's
       *   "required" and "provided" attributes.
       * @return {Array} A collection of interface names extracted from the
       *   input.
       */
      getInterfaces = function(data) {
        if (data) {
          return Y.Array.map(
              Y.Object.values(data),
              function(val) { return val['interface']; });
        }
        return undefined;
      };

  /**
   * Charm collection view. Show a list of charms, each clickable through
   * for a description, or deployed directly with a "Deploy" button.
   *
   * @class CharmCollectionView
   */
  var CharmCollectionView = Y.Base.create('CharmCollectionView', Y.View, [], {
    template: views.Templates['charm-search-result'],
    events: {
      'a.charm-detail': {click: 'showDetails'},
      '.charm-entry .btn.deploy': {click: 'showConfiguration'},
      '.charm-entry': {

        /**
         * Show the charm deploy button on mouse pointer enter.
         *
         * @method CharmCollectionView.events.mouseenter
         */
        mouseenter: function(ev) {
          ev.currentTarget.all('.btn').transition({opacity: 1, duration: 0.25});
        },

        /**
         * Hide the charm deploy button on mouse pointer leave.
         *
         * @method CharmCollectionView.events.mouseleave
         */
        mouseleave: function(ev) {
          ev.currentTarget.all('.btn').transition({opacity: 0, duration: 0.25});
        }

      },
      '.charm-filter-picker .picker-button': {
        click: 'showCharmFilterPicker'
      },
      '.charm-filter-picker .picker-item': {
        click: 'hideCharmFilterPicker'
      }
    },

    /**
     * Set searchText to cause the results to be found and rendered.
     *
     * Set defaultSeries to cause all the results for the default series
     * to be found and rendered.
     *
     * @method CharmCollectionView.initializer
     */
    initializer: function() {
      var self = this;
      this.set('filter', 'all');
      this.after('searchTextChange', function(ev) {
        this.set('resultEntries', null);
        if (ev.newVal) {
          this.get('charmStore').find(
              ev.newVal,
              { success: function(charms) {
                self.set('resultEntries', charms);
              },
              failure: Y.bind(this._showErrors, this),
              defaultSeries: this.get('defaultSeries'),
              list: this.get('charms')
              });
        }
      });

      this.after('defaultSeriesChange', function(ev) {
        this.set('defaultEntries', null);
        if (ev.newVal) {
          this.get('charmStore').find(
              {series: ev.newVal, owner: 'charmers'},
              { success: function(charms) {
                self.set('defaultEntries', charms);
              },
              failure: Y.bind(this._showErrors, this),
              defaultSeries: this.get('defaultSeries'),
              list: this.get('charms')
              });
        }
      });
      this.after('defaultEntriesChange', function() {
        if (!this.get('searchText')) {
          this.render();
        }
      });
      this.after('resultEntriesChange', function() {
        this.render();
      });
      this.after('heightChange', this._setScroll);
    },

    /**
     * @method CharmCollectionView.render
     */
    render: function() {
      var container = this.get('container'),
          searchText = this.get('searchText'),
          defaultEntries = this.get('defaultEntries'),
          resultEntries = this.get('resultEntries'),
          rawEntries = searchText ? resultEntries : defaultEntries,
          entries,
          db = this.get('db') || undefined,
          services = db && db.services || undefined,
          filtered = {},
          filters = ['all', 'subordinates', 'deployed'];

      if (!rawEntries) {
        return this;
      }
      for (var sel in filters) {
        if (true) { // Avoid lint warning.
          filtered[filters[sel]] = filterEntries(
              rawEntries, filters[sel], services);
        }
      }

      entries = makeRenderableResults(filtered[this.get('filter')]);
      var countEntries = function(entries) {
        if (!entries) {return 0;}
        var lengths = entries.map(function(e) {return e.charms.length;});
        // Initial value of 0 required since the array may be empty.
        return lengths.reduce(function(pv, cv) {return pv + cv;}, 0);
      };

      container.setHTML(this.template(
          { charms: entries,
            allCharmsCount: countEntries(filtered.all),
            subordinateCharmsCount: countEntries(filtered.subordinates),
            deployedCharmsCount: countEntries(filtered.deployed)
          }));

      // The picker has now been rendered generically.  Based on the
      // filter add the decorations.
      var selected = container.one('.' + this.get('filter')),
          picker = container.one('.charm-filter-picker');
      selected.addClass('activetick');
      picker.one('.picker-body').set('text', selected.get('text'));
      // The charm details and summary are user-supplied and may be
      // way too big for the fixed height cells.  Sadly the best we
      // can do is truncate them with elllipses.
      container.all('.charm-detail').ellipsis();
      container.all('.charm-summary').ellipsis({'lines': 2});
      this._setScroll();
      return this;
    },

    /**
     * When the view's "height" attribute is set, adjust the internal
     * scrollable div to have the appropriate height.
     *
     * @method _setScroll
     * @protected
     * @return {undefined} Mutates only.
     */
    _setScroll: function() {
      var container = this.get('container'),
          scrollContainer = container.one('.search-result-div'),
          height = this.get('height');
      if (scrollContainer && height) {
        scrollContainer.setStyle('height', height - 1 + 'px');
      }
    },

    /**
     * Fire an event indicating that the charm panel should switch to the
     * "description" for a given charm.
     *
     * @method showDetails
     * @param {Object} ev An event object (with a `halt` method).
     * @return {undefined} Sends a signal only.
     */
    showDetails: function(ev) {
      ev.halt();
      this.fire(
          'changePanel',
          { name: 'description',
            charmId: ev.target.getAttribute('href') });
    },

    /**
     * Fire an event indicating that the charm panel should switch to the
     * "configuration" for a given charm.
     *
     * @method showConfiguration
     * @param {Object} ev An event object (with a `halt` method).
     * @return {undefined} Sends a signal only.
     */
    showConfiguration: function(ev) {
      // Without the ev.halt the 'outside' click handler is getting
      // called which immediately closes the panel.
      ev.halt();
      this.fire(
          'changePanel',
          { name: 'configuration',
            charmId: ev.currentTarget.getData('url')});
    },

    /**
     * Create a data structure friendly to the view.
     *
     * @method normalizeCharms.
     */
    normalizeCharms: function(charms) {
      var hash = {},
          defaultSeries = this.get('defaultSeries');
      Y.each(charms, function(charm) {
        charm.url = charm.series + '/' + charm.name;
        if (charm.owner === 'charmers') {
          charm.owner = null;
        } else {
          charm.url = '~' + charm.owner + '/' + charm.url;
        }
        charm.url = 'cs:' + charm.url;
        if (!Y.Lang.isValue(hash[charm.series])) {
          hash[charm.series] = [];
        }
        hash[charm.series].push(charm);
      });
      var series_names = Y.Object.keys(hash);
      series_names.sort(function(a, b) {
        if ((a === defaultSeries && b !== defaultSeries) || a > b) {
          return -1;
        } else if ((a !== defaultSeries && b === defaultSeries) || a < b) {
          return 1;
        } else {
          return 0;
        }
      });
      return Y.Array.map(series_names, function(name) {
        var charms = hash[name];
        charms.sort(function(a, b) {
          // If !a.owner, that means it is owned by charmers.
          if ((!a.owner && b.owner) || (a.owner < b.owner)) {
            return -1;
          } else if ((a.owner && !b.owner) || (a.owner > b.owner)) {
            return 1;
          } else if (a.name < b.name) {
            return -1;
          } else if (a.name > b.name) {
            return 1;
          } else {
            return 0;
          }
        });
        return {series: name, charms: hash[name]};
      });
    },

    /**
     * Find charms that match a query.
     *
     * @method findCharms
     */
    findCharms: function(query, callback) {
      var charmStore = this.get('charmStore'),
          db = this.get('db');
      charmStore.sendRequest({
        request: 'search/json?search_text=' + query,
        callback: {
          'success': Y.bind(function(io_request) {
            // To see an example of what is being obtained, look at
            // http://jujucharms.com/search/json?search_text=mysql .
            var result_set = Y.JSON.parse(
                io_request.response.results[0].responseText);
            console.log('results update', result_set);
            callback(this.normalizeCharms(result_set.results));
          }, this),
          'failure': function er(e) {
            console.error(e.error);
            db.notifications.add(
                new models.Notification({
                  title: 'Could not retrieve charms',
                  message: e.error,
                  level: 'error'
                })
            );
          }}});
    },

    /**
     * Show errors on both console and notifications.
     *
     * @method _showErrors
     */
    _showErrors: function(e) {
      console.error(e.error);
      this.get('db').notifications.add(
          new models.Notification({
            title: 'Could not retrieve charms',
            message: e.error,
            level: 'error'
          })
      );
    },

    /**
     * Event handler to show the charm filter picker.
     *
     * @method showCharmFilterPicker
     * @param {Object} evt The event.
     * @return {undefined} nothing.
     */
    showCharmFilterPicker: function(evt) {
      var container = this.get('container'),
          picker = container.one('.charm-filter-picker');
      picker.addClass('inactive');
      picker.one('.picker-expanded').addClass('active');
    },

    /**
     * Event handler to hide the charm filter picker
     *
     * @method hideCharmFilterPicker
     * @param {Object} evt The event.
     * @return {undefined} nothing.
     */
    hideCharmFilterPicker: function(evt) {
      // Set the filter and re-render the control.
      var selected = evt.currentTarget;
      this.set('filter', selected.getData('filter'));
      this.render();
      evt.halt();
    }

  });
  views.CharmCollectionView = CharmCollectionView;

  /**
   * Charm description view. It describes a charm's features in detail,
   * together with a "Deploy" button.
   *
   * @class CharmDescriptionView
   */
  var CharmDescriptionView = Y.Base.create(
      'CharmDescriptionView', Y.View, [views.JujuBaseView], {
        template: views.Templates['charm-description'],
        relatedTemplate: views.Templates['charm-description-related'],
        events: {
          '.charm-nav-back': {click: 'goBack'},
          '.btn': {click: 'deploy'},
          '.charm-section h4': {click: toggleSectionVisibility},
          'a.charm-detail': {click: 'showDetails'}
        },
        /**
         * @method CharmDescriptionView.initializer
         */
        initializer: function() {
          this.bindModelView(this.get('model'));
          this.after('heightChange', this._setScroll);
        },
        /**
         * @method CharmDescriptionView.render
         */
        render: function() {
          var container = this.get('container'),
              charm = this.get('model');
          if (Y.Lang.isValue(charm)) {
            container.setHTML(this.template(charm.getAttrs()));
            container.all('i.chevron_down').each(function(el) {
              el.ancestor('.charm-section').one('div')
                .setStyle('height', '0px');
            });
            var slot = container.one('#related-charms');
            if (slot) {
              this.getRelatedCharms(charm, slot);
            }
          } else {
            container.setHTML(
                '<div class="alert">Waiting on charm data...</div>');
          }
          this._setScroll();
          return this;
        },
        /**
         * Get related charms and render them in the provided node.  Typically
         * this is asynchronous, waiting on charm store results.
         *
         * @method getRelatedCharms
         * @param {Object} charm A charm model.  Finds charms related to the
         *   required and provided interfaces of this charm.
         * @param {Object} slot An YUI node that will contain the results (using
         *   setHTML).
         * @return {undefined} Mutates slot only.
         */
        getRelatedCharms: function(charm, slot) {
          var store = this.get('charmStore'),
              defaultSeries = this.get('defaultSeries'),
              list = this.get('charms'),
              self = this,
              query = {
                op: 'union',
                requires: getInterfaces(charm.get('provides')),
                provides: getInterfaces(charm.get('requires'))
              };
          if (query.requires || query.provides) {
            store.find(
                query,
                {
                  /**
                   * If the charm we searched for is still the same as the
                   * view's charm, ask renderRelatedCharms to render the
                   * results.  If they differ, discard the results, because they
                   * are no longer relevant.
                   *
                   * @method getRelatedCharms.store.find.success
                   */
                  success: function(related) {
                    if (charm === self.get('model')) {
                      self.renderRelatedCharms(related, slot);
                    }
                  },
                  /**
                   * If there was a failure, render it to the console and to the
                   * notifications section.
                   *
                   * @method getRelatedCharms.store.find.failure
                   */
                  failure: function(e) {
                    console.error(e.error);
                    self.get('db').notifications.add(
                        new models.Notification({
                          title: 'Could not retrieve charm data',
                          message: e.error,
                          level: 'error'
                        })
                    );
                  },
                  defaultSeries: defaultSeries,
                  list: list
                }
            );
          } else {
            slot.setHTML('None');
          }
        },
        /**
         * Given a grouped list of related charms such as those returned by the
         * charm store's "find" method, and a node into which the results should
         * be rendered, render the results into HTML and sets that into the
         * node.
         *
         * @method renderRelatedCharms
         * @param {Array} related A list of grouped charms such as those
         *   returned by the charm store's "find" method.
         * @param {Object} slot A node into which the results should be
         *   rendered.
         * @return {undefined} Mutates only.
         */
        renderRelatedCharms: function(related, slot) {
          if (related.length) {
            slot.setHTML(this.relatedTemplate(
                {charms: makeRenderableResults(related)}));
            // Make container big enough if it is open.
            if (slot.get('clientHeight') > 0) {
              slot.show('sizeIn', {duration: 0.25, width: null});
            }
          } else {
            slot.setHTML('None');
          }
        },
        /**
         * When the view's "height" attribute is set, adjust the internal
         * scrollable div to have the appropriate height.
         *
         * @method _setScroll
         * @protected
         * @return {undefined} Mutates only.
         */
        _setScroll: function() {
          setScroll(this.get('container'), this.get('height'));
        },
        /**
         * Fire an event indicating that the charm panel should switch to the
         * "charms" search result view.
         *
         * @method goBack
         * @param {Object} ev An event object (with a "halt" method).
         * @return {undefined} Sends a signal only.
         */
        goBack: function(ev) {
          ev.halt();
          this.fire('changePanel', { name: 'charms' });
        },
        /**
         * Fire an event indicating that the charm panel should switch to the
         * "configuration" panel for the current charm.
         *
         * @method deploy
         * @param {Object} ev An event object (with a "halt" method).
         * @return {undefined} Sends a signal only.
         */
        deploy: function(ev) {
          ev.halt();
          this.fire(
              'changePanel',
              { name: 'configuration',
                charmId: ev.currentTarget.getData('url')});
        },
        /**
         * Fire an event indicating that the charm panel should switch to the
         * same "description" panel but with a new charm.  This is used by the
         * "related charms" links.
         *
         * @method showDetails
         * @param {Object} ev An event object (with a "halt" method).
         * @return {undefined} Sends a signal only.
         */
        showDetails: function(ev) {
          ev.halt();
          this.fire(
              'changePanel',
              { name: 'description',
                charmId: ev.target.getAttribute('href') });
        }
      });
  views.CharmDescriptionView = CharmDescriptionView;

  /**
   * Display a charm's configuration panel. It shows editable fields for
   * the charm's configuration parameters, together with a "Cancel" and
   * a "Confirm" button for deployment.
   *
   * @class CharmConfigurationView
   */
  var CharmConfigurationView = Y.Base.create(
      'CharmConfigurationView', Y.View, [views.JujuBaseView], {
        template: views.Templates['charm-pre-configuration'],
        tooltip: null,
        configFileContent: null,

        /**
         * @method CharmConfigurationView.initializer
         */
        initializer: function() {
          this.bindModelView(this.get('model'));
          this.after('heightChange', this._setScroll);
          this.after('changePanel', this._clearGhostService);
        },

        /**
         * @method CharmConfigurationView.render
         */
        render: function() {
          var container = this.get('container'),
              charm = this.get('model'),
              config = charm && charm.get('config'),
              settings = config && utils.extractServiceSettings(
                  config.options),
              self = this;
          if (charm && charm.loaded) {
            container.setHTML(this.template(
                { charm: charm.getAttrs(),
                  settings: settings}));
            // Set up entry description overlay.
            this.setupOverlay(container);
            // This does not work via delegation.
            container.one('.charm-panel').after(
                'scroll', Y.bind(this._moveTooltip, this));

            // Create a 'ghost' service to represent what will be deployed.
            var db = this.get('db');
            var ghostService = db.services.create({
              id: '(' + charm.get('package_name') + ')',
              pending: true,
              charm: charm.get('id'),
              unit_count: 0,  // No units yet.
              loaded: false,
              config: config
            });
            this.set('ghostService', ghostService);
            db.fire('update');
          } else {
            container.setHTML(
                '<div class="alert">Waiting on charm data...</div>');
          }
          this._setScroll();
          return this;
        },

        /**
         * When the view's "height" attribute is set, adjust the internal
         * scrollable div to have the appropriate height.
         *
         * @method _setScroll
         * @protected
         * @return {undefined} Mutates only.
         */
        _setScroll: function() {
          setScroll(this.get('container'), this.get('height'));
        },

        events: {
          '.btn.cancel': {click: 'goBack'},
          '.btn.deploy': {click: 'onCharmDeployClicked'},
          '.charm-section h4': {click: toggleSectionVisibility},
          '.config-file-upload-widget': {change: 'onFileChange'},
          '.config-file-upload-overlay': {click: 'onOverlayClick'},
          '.config-field': {focus: 'showDescription',
            blur: 'hideDescription'},
          'input.config-field[type=checkbox]':
              {click: function(evt) {evt.target.focus();}}
        },

        /**
         * Determine the Y coordinate that would center a tooltip on a field.
         *
         * @static
         * @param {Number} fieldY The current Y position of the tooltip.
         * @param {Number} fieldHeight The hight of the field.
         * @param {Number} tooltipHeight The height of the tooltip.
         * @return {Number} New Y coordinate for the tooltip.
         * @method _calculateTooltipY
         */
        _calculateTooltipY: function(fieldY, fieldHeight, tooltipHeight) {
          var y_offset = (tooltipHeight - fieldHeight) / 2;
          return fieldY - y_offset;
        },

        /**
         * Determine the X coordinate that would place a tooltip next to a
         * field.
         *
         * @static
         * @param {Number} fieldX The current X position of the tooltip.
         * @param {Number} tooltipWidth The width of the tooltip.
         * @return {Number} New X coordinate for the tooltip.
         * @method _calculateTooltipX
         */
        _calculateTooltipX: function(fieldX, tooltipWidth) {
          return fieldX - tooltipWidth - 15;
        },

        /**
         * Move a tooltip to its predefined position.
         *
         * @method _moveTooltip
         */
        _moveTooltip: function() {
          if (this.tooltip.field &&
              Y.DOM.inRegion(
              this.tooltip.field.getDOMNode(),
              this.tooltip.panelRegion,
              true)) {
            var fieldHeight = this.tooltip.field.get('clientHeight');
            if (fieldHeight) {
              var widget = this.tooltip.get('boundingBox'),
                  tooltipWidth = widget.get('clientWidth'),
                  tooltipHeight = widget.get('clientHeight'),
                  fieldX = this.tooltip.panel.getX(),
                  fieldY = this.tooltip.field.getY(),
                  tooltipX = this._calculateTooltipX(
                      fieldX, tooltipWidth),
                  tooltipY = this._calculateTooltipY(
                      fieldY, fieldHeight, tooltipHeight);
              this.tooltip.move([tooltipX, tooltipY]);
              if (!this.tooltip.get('visible')) {
                this.tooltip.show();
              }
            }
          } else if (this.tooltip.get('visible')) {
            this.tooltip.hide();
          }
        },

        /**
         * Show the charm's description.
         *
         * @method showDescription
         */
        showDescription: function(evt) {
          var controlGroup = evt.target.ancestor('.control-group'),
              node = controlGroup.one('.control-description'),
              text = node.get('text').trim();
          this.tooltip.setStdModContent('body', text);
          this.tooltip.field = evt.target;
          this.tooltip.panel = this.tooltip.field.ancestor(
              '.charm-panel');
          // Stash for speed.
          this.tooltip.panelRegion = Y.DOM.region(
              this.tooltip.panel.getDOMNode());
          this._moveTooltip();
        },

        /**
         * Hide the charm's description.
         *
         * @method hideDescription
         */
        hideDescription: function(evt) {
          this.tooltip.hide();
          delete this.tooltip.field;
        },

        /**
         * Pass clicks on the overlay on to the correct recipient.
         * The recipient can be the upload widget or the file remove one.
         *
         * @method onOverlayClick
         * @param {Object} evt An event object.
         * @return {undefined} Dispatches only.
         */
        onOverlayClick: function(evt) {
          var container = this.get('container');
          if (this.configFileContent) {
            this.onFileRemove();
          } else {
            container.one('.config-file-upload-widget').getDOMNode().click();
          }
        },

        /**
         * Handle the file upload click event.
         * Call onFileLoaded or onFileError if an error occurs during upload.
         *
         * @method onFileChange
         * @param {Object} evt An event object.
         * @return {undefined} Mutates only.
         */
        onFileChange: function(evt) {
          var container = this.get('container');
          console.log('onFileChange:', evt);
          this.fileInput = evt.target;
          var file = this.fileInput.get('files').shift(),
              reader = new FileReader();
          container.one('.config-file-name').setContent(file.name);
          reader.onerror = Y.bind(this.onFileError, this);
          reader.onload = Y.bind(this.onFileLoaded, this);
          reader.readAsText(file);
          container.one('.config-file-upload-overlay')
            .setContent('Remove file');
        },

        /**
         * Handle the file remove click event.
         * Restore the file upload widget on click.
         *
         * @method onFileRemove
         * @return {undefined} Mutates only.
         */
        onFileRemove: function() {
          var container = this.get('container');
          this.configFileContent = null;
          container.one('.config-file-name').setContent('');
          container.one('.charm-settings').show();
          // Replace the file input node.  There does not appear to be any way
          // to reset the element, so the only option is this rather crude
          // replacement.  It actually works well in practice.
          this.fileInput.replace(Y.Node.create('<input type="file"/>')
                                 .addClass('config-file-upload-widget'));
          this.fileInput = container.one('.config-file-upload-widget');
          var overlay = container.one('.config-file-upload-overlay');
          overlay.setContent('Use configuration file');
          // Ensure the charm section height is correctly restored.
          overlay.ancestor('.collapsible')
            .show('sizeIn', {duration: 0.25, width: null});
        },

        /**
         * Callback called when a file is correctly uploaded.
         * Hide the charm configuration section.
         *
         * @method onFileLoaded
         * @param {Object} evt An event object.
         * @return {undefined} Mutates only.
         */
        onFileLoaded: function(evt) {
          this.configFileContent = evt.target.result;

          if (!this.configFileContent) {
            // Some file read errors do not go through the error handler as
            // expected but instead return an empty string.  Warn the user if
            // this happens.
            var db = this.get('db');
            db.notifications.add(
                new models.Notification({
                  title: 'Configuration file error',
                  message: 'The configuration file loaded is empty.  ' +
                      'Do you have read access?',
                  level: 'error'
                }));
          }
          this.get('container').one('.charm-settings').hide();
        },

        /**
         * Callback called when an error occurs during file upload.
         * Hide the charm configuration section.
         *
         * @method onFileError
         * @param {Object} evt An event object (with a "target.error" attr).
         * @return {undefined} Mutates only.
         */
        onFileError: function(evt) {
          console.log('onFileError:', evt);
          var msg;
          switch (evt.target.error.code) {
            case evt.target.error.NOT_FOUND_ERR:
              msg = 'File not found';
              break;
            case evt.target.error.NOT_READABLE_ERR:
              msg = 'File is not readable';
              break;
            case evt.target.error.ABORT_ERR:
              break; // noop
            default:
              msg = 'An error occurred reading this file.';
          }
          if (msg) {
            var db = this.get('db');
            db.notifications.add(
                new models.Notification({
                  title: 'Error reading configuration file',
                  message: msg,
                  level: 'error'
                }));
          }
          return;
        },

        /**
         * Fires an event indicating that the charm panel should switch to the
         * "charms" search result view. Called upon clicking the "Cancel"
         * button.
         *
         * @method goBack
         * @param {Object} ev An event object (with a "halt" method).
         * @return {undefined} Sends a signal only.
         */
        goBack: function(ev) {
          ev.halt();
          this.fire('changePanel', { name: 'charms' });
        },

        _clearGhostService: function(ev) {
          // Remove the ghost service from the environment.
          var db = this.get('db');
          var ghostService = this.get('ghostService');
          if (Y.Lang.isValue(ghostService)) {
            db.services.remove(ghostService);
            db.fire('update');
          }
        },

        /**
         * Called upon clicking the "Confirm" button.
         *
         * @method onCharmDeployClicked
         * @param {Object} ev An event object (with a "halt" method).
         * @return {undefined} Sends a signal only.
         */
        onCharmDeployClicked: function(evt) {
          var container = this.get('container');
          var db = this.get('db');
          var ghostService = this.get('ghostService');
          var env = this.get('env');
          var serviceName = container.one('#service-name').get('value');
          var numUnits = container.one('#number-units').get('value');
          var charm = this.get('model');
          var url = charm.get('id');
          var config = utils.getElementsValuesMapping(container,
                  '#service-config .config-field');
          var self = this;
          // The service names must be unique.  It is an error to deploy a
          // service with same name.
          var existing_service = db.services.getById(serviceName);
          if (Y.Lang.isValue(existing_service)) {
            console.log('Attempting to add service of the same name: ' +
                        serviceName);
            db.notifications.add(
                new models.Notification({
                  title: 'Attempting to deploy service ' + serviceName,
                  message: 'A service with that name already exists.',
                  level: 'error'
                }));
            return;
          }
          if (this.configFileContent) {
            config = null;
          }
          numUnits = parseInt(numUnits, 10);
          env.deploy(url, serviceName, config, this.configFileContent,
              numUnits, function(ev) {
                if (ev.err) {
                  console.log(url + ' deployment failed');
                  db.notifications.add(
                      new models.Notification({
                        title: 'Error deploying ' + serviceName,
                        message: 'Could not deploy the requested service.',
                        level: 'error'
                      }));
                } else {
                  console.log(url + ' deployed');
                  db.notifications.add(
                      new models.Notification({
                        title: 'Deployed ' + serviceName,
                        message: 'Successfully deployed the requested service.',
                        level: 'info'
                      })
                  );
                  // Update the ghost service to match the configuration.
                  ghostService.setAttrs({
                    id: serviceName,
                    charm: charm.get('id'),
                    unit_count: 0,  // No units yet.
                    loaded: false,
                    pending: false,
                    config: config
                  });
                  // Force refresh.
                  db.fire('update');
                  self.set('ghostService', null);
                }
                self.goBack(evt);
              });
        },

        /**
         * Setup the panel overlay.
         *
         * @method setupOverlay
         * @param {Object} container The container element.
         * @return {undefined} Side effects only.
         */
        setupOverlay: function(container) {
          var self = this;
          container.appendChild(Y.Node.create('<div/>'))
            .set('id', 'tooltip');
          self.tooltip = new Y.Overlay({ srcNode: '#tooltip',
            visible: false});
          this.tooltip.render();
        }
      });
  views.CharmConfigurationView = CharmConfigurationView;

  /**
   * Create the "_instance" object.
   *
   * @method createInstance
   */
  function createInstance(config) {

    var charmStore = config.charm_store,
        charms = new models.CharmList(),
        app = config.app,
        container = Y.Node.create('<div />').setAttribute(
            'id', 'juju-search-charm-panel'),
        charmsSearchPanelNode = Y.Node.create(),
        charmsSearchPanel = new CharmCollectionView(
              { container: charmsSearchPanelNode,
                env: app.env,
                db: app.db,
                charms: charms,
                charmStore: charmStore }),
        descriptionPanelNode = Y.Node.create(),
        descriptionPanel = new CharmDescriptionView(
              { container: descriptionPanelNode,
                env: app.env,
                db: app.db,
                charms: charms,
                charmStore: charmStore }),
        configurationPanelNode = Y.Node.create(),
        configurationPanel = new CharmConfigurationView(
              { container: configurationPanelNode,
                env: app.env,
                db: app.db}),
        panels =
              { charms: charmsSearchPanel,
                description: descriptionPanel,
                configuration: configurationPanel },
        // panelHeightOffset takes into account the height of the
        // charm filter picker widget, which only appears on the
        // "charms" panel.
        panelHeightOffset = {
          charms: 33,
          description: 0,
          configuration: 0},
        isPanelVisible = false,
        trigger = Y.one('#charm-search-trigger'),
        searchField = Y.one('#charm-search-field'),
        ENTER = Y.Node.DOM_EVENTS.key.eventDef.KEY_MAP.enter,
        activePanelName;

    Y.one(document.body).append(container);
    container.hide();

    /**
     * Setup the panel data.
     *
     * @method setPanel
     */
    function setPanel(config) {
      var newPanel = panels[config.name];
      if (!Y.Lang.isValue(newPanel)) {
        throw 'Developer error: Unknown panel name ' + config.name;
      }
      activePanelName = config.name;
      container.get('children').remove();
      container.append(panels[config.name].get('container'));
      newPanel.set('height', calculatePanelPosition().height -
                   panelHeightOffset[activePanelName] - 1);
      if (config.charmId) {
        newPanel.set('model', null); // Clear out the old.
        var charm = charms.getById(config.charmId);
        if (charm.loaded) {
          newPanel.set('model', charm);
        } else {
          charm.load(charmStore, function(err, response) {
            if (err) {
              console.log('error loading charm', response);
              newPanel.fire('changePanel', {name: 'charms'});
            } else {
              newPanel.set('model', charm);
            }
          });
        }
      } else { // This is the search panel.
        newPanel.render();
      }
    }

    Y.Object.each(panels, function(panel) {
      subscriptions.push(panel.on('changePanel', setPanel));
    });
    // The panel starts with the "charmsSearchPanel" visible.
    setPanel({name: 'charms'});

    // Update position if we resize the window.
    subscriptions.push(Y.on('windowresize', function(e) {
      if (isPanelVisible) {
        updatePanelPosition();
      }
    }));

    /**
     * Hide the charm panel.
     * Set isPanelVisible to false.
     *
     * @method hide
     * @return {undefined} Mutates only.
     */
    function hide() {
      if (isPanelVisible) {
        var headerBox = Y.one('#charm-search-trigger-container'),
            headerSpan = headerBox && headerBox.one('span');
        if (headerBox) {
          headerBox.removeClass('active-border');
          if (headerSpan) {
            headerSpan.addClass('active-border');
          }
        }
        container.hide();
        if (Y.Lang.isValue(trigger)) {
          trigger.one('i#charm-search-chevron').replaceClass(
              'chevron_up', 'chevron_down');
        }
        isPanelVisible = false;
      }
    }
    subscriptions.push(container.on('clickoutside', hide));
    subscriptions.push(Y.on('beforePageSizeRecalculation', function() {
      container.setStyle('display', 'none');
    }));
    subscriptions.push(Y.on('afterPageSizeRecalculation', function() {
      if (isPanelVisible) {
        // We need to do this both in windowresize and here because
        // windowresize can only be fired with "on," and so we cannot know
        // which handler will be fired first.
        updatePanelPosition();
      }
    }));

    /**
     * Show the charm panel.
     * Set isPanelVisible to true.
     *
     * @method show
     * @return {undefined} Mutates only.
     */
    function show() {
      if (!isPanelVisible) {
        var headerBox = Y.one('#charm-search-trigger-container'),
            headerSpan = headerBox && headerBox.one('span');
        if (headerBox) {
          headerBox.addClass('active-border');
          if (headerSpan) {
            headerSpan.removeClass('active-border');
          }
        }
        container.setStyles({opacity: 0, display: 'block'});
        container.show(true);
        isPanelVisible = true;
        updatePanelPosition();
        if (Y.Lang.isValue(trigger)) {
          trigger.one('i#charm-search-chevron').replaceClass(
              'chevron_down', 'chevron_up');
        }
      }
    }

    /**
     * Show the charm panel if it is hidden, hide it otherwise.
     *
     * @method toggle
     * @param {Object} ev An event object (with a "halt" method).
     * @return {undefined} Dispatches only.
     */
    function toggle(ev) {
      if (Y.Lang.isValue(ev)) {
        // This is important to not have the clickoutside handler immediately
        // undo a "show".
        ev.halt();
      }
      if (isPanelVisible) {
        hide();
      } else {
        show();
      }
    }

    /**
     * Update the panel position.
     *
     * This should only be called when the popup is supposed to be visible.
     * We need to hide the popup before we calculate positions, so that it
     * does not cause scrollbars to appear while we are calculating
     * positions.  The temporary scrollbars can cause the calculations to
     * be incorrect.
     *
     * @method updatePanelPosition
     */
    function updatePanelPosition() {
      container.setStyle('display', 'none');
      var pos = calculatePanelPosition();
      container.setStyle('display', 'block');
      container.setX(pos.x);
      if (pos.height) {
        var height = pos.height - panelHeightOffset[activePanelName];
        container.setStyle('height', pos.height + 'px');
        panels[activePanelName].set('height', height - 1);
      }
    }

    /**
     * Calculate the panel position.
     *
     * @method calculatePanelPosition
     */
    function calculatePanelPosition() {
      var headerBox = Y.one('#charm-search-trigger-container'),
          dimensions = utils.getEffectiveViewportSize();
      return { x: headerBox && Math.round(headerBox.getX()),
               height: dimensions.height + 18 };
    }

    if (Y.Lang.isValue(trigger)) {
      subscriptions.push(trigger.on('click', toggle));
    }

    var handleKeyDown = function(ev) {
      if (ev.keyCode === ENTER) {
        ev.halt(true);
        show();
        charmsSearchPanel.set('searchText', ev.target.get('value'));
        setPanel({name: 'charms'});
      }
    };

    if (searchField) {
      subscriptions.push(searchField.on('keydown', handleKeyDown));
    }

    // The public methods.
    return {
      hide: hide,
      toggle: toggle,
      show: show,
      node: container,

      /**
       * Set the default charm series in the search and description panels.
       *
       * @method setDefaultSeries
       */
      setDefaultSeries: function(series) {
        charmsSearchPanel.set('defaultSeries', series);
        descriptionPanel.set('defaultSeries', series);
      }
    };
  }

  // The public methods.
  views.CharmPanel = {

    /**
     * Get the instance, creating it if it does not yet exist.
     *
     * @method getInstance
     */
    getInstance: function(config) {
      if (!_instance) {
        _instance = createInstance(config);
      }
      return _instance;
    },

    /**
     * Destroy the instance and its node, detaching all subscriptions.
     *
     * @method getInstance
     */
    killInstance: function() {
      while (subscriptions.length) {
        var sub = subscriptions.pop();
        if (sub) { sub.detach(); }
      }
      if (_instance) {
        _instance.node.remove(true);
        _instance = null;
      }
    }
  };

  // Exposed for testing.
  views.filterEntries = filterEntries;

}, '0.1.0', {
  requires: [
    'view',
    'juju-view-utils',
    'juju-templates',
    'node',
    'handlebars',
    'event-hover',
    'transition',
    'event-key',
    'event-outside',
    'widget-anim',
    'overlay',
    'dom-core',
    'juju-models',
    'event-resize',
    'gallery-ellipsis'
  ]
});
