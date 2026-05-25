#!/bin/bash
cd /root/website
git pull origin main
cd leaderboard-deploy/backend
npm install
pm2 restart server
