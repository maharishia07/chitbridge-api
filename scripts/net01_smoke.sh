#!/usr/bin/env bash
set -e
API="${API:-http://localhost:3000}/api/network"
jq_id(){ jq -r .id; }; jq_bid(){ jq -r .bridge_id; }
A=$(curl -s -XPOST $API/entities -H 'content-type: application/json' -d '{"name":"Alpha"}'); AID=$(echo $A|jq_id)
B=$(curl -s -XPOST $API/entities -H 'content-type: application/json' -d '{"name":"Bravo"}'); BBID=$(echo $B|jq_bid); BID=$(echo $B|jq_id)
echo "lookup:"; curl -s "$API/entities/lookup?bridgeId=$BBID"; echo
E=$(curl -s -XPOST $API/connections -H 'content-type: application/json' -d "{\"parentId\":\"$AID\",\"childBridgeId\":\"$BBID\"}"); EID=$(echo $E|jq_id)
echo "approve:"; curl -s -XPOST $API/connections/$EID/approve -H 'content-type: application/json' -d "{\"actingEntityId\":\"$BID\"}"; echo
echo "A subtree:"; curl -s $API/entities/$AID/subtree; echo
echo "disconnect:"; curl -s -XPOST $API/connections/$EID/disconnect -H 'content-type: application/json' -d '{"settle":true}'; echo
echo "A subtree after:"; curl -s $API/entities/$AID/subtree; echo
