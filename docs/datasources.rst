============
Datasources
============

Upstream Charm Store
====================

The charm store data is pulled from an upstream API provided by the
`Charmworld`_ application. It provides two sets of APIs used by the Juju GUI
currently.

The first is an unversioned basic API used to get started.

The second API is represented in the Juju GUI by the store class
``Charmworld2``. It's the version 2 of the Charmworld API. It provides end
points for fetching information about charms, searches for charms, content for
files in charms, as well as QA data. This data feeds the updated Juju GUI
Browser UX.

.. _Charmworld: http://launchpad.net/charmworld

Configuration
-------------

Specify the url of the Charmworld instance in the config setting
``charmworldURL``.

About Charmworld
-----------------

Charmworld is a Pyramid web application and is `Charm`_'d to run on OpenStack.
Documentation for hacking on Charmworld can be found in its `working tree`_.

.. _Charm: http://jujucharms.com/~juju-jitsu/precise/charmworld
.. _working tree: http://bazaar.launchpad.net/~juju-jitsu/charmworld/trunk/view/head:/docs/index.rst

Development with a local Charmworld
------------------------------------

There might come a time when working with a local Charmworld instance is
beneficial (offline mode, adding new features). To setup an environment in
this way you need to prepare a local environment per Charmworld's
documentation. This is usually just a ``bzr branch lp:charmworld && make
install && make run``. Make sure to run through the injest steps so that your
instance contains data to be fed through the API endpoints.

Once the local Charmworld instance is running you need to change the config
setting to point to your locally running instance instead of the remote one.
