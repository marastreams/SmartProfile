# This shell script provides a simple way to deploy + verify lsp-smart-contracts
# options:
#   -c: name of the contract to deploy + verify
#   -n: network to deploy + verify the contract on
while getopts c:d:n: flag
do
    case "${flag}" in
        c) contract=${OPTARG};;
        n) network=${OPTARG};;
    esac
done

# Save the output of the deployment in a text file.
npx hardhat deploy --network ${network} --tags ${contract} --reset >> deployment.txt
CONTRACT_ADDRESS=$(grep -o -E '0x(\w|\s){40}' deployment.txt | tail -n 1)

# Verify UniversalProfile with constructor arguments
if [ "${contract}" = "UniversalProfile" ]
then 
    npx hardhat verify $CONTRACT_ADDRESS $DEPLOYER_ADDRESS --network luksoL16 --contract contracts/UniversalProfile.sol:UniversalProfile

# Verify LSP6KeyManager contracts with constructor arguments
elif [ "${contract}" = "LSP6KeyManager" ]
then
    # specify the contract as UniversalProfile and LSP0ERC725Account have the same runtime code.
    LINKED_UP_IN_CONSTRUCTOR=$(grep -o -E '0x(\w|\s){40}' deployment.txt | head -n 2 | tail -n 1)
    npx hardhat verify $CONTRACT_ADDRESS $LINKED_UP_IN_CONSTRUCTOR --network luksoL16

# Verify LSP7Mintable contract with constructor arguments
elif [ "${contract}" = "LSP7Mintable" ]
then
    # LSP7 constructor takes a boolean parameter that error when passed as CLI argument.
    # Create js file with constructor arguments to bypass this error.
    echo "module.exports = [ 'LSP7 Mintable', 'LSP7M', '$DEPLOYER_ADDRESS', false ];" >> lsp7arguments.js
    npx hardhat verify $CONTRACT_ADDRESS --network luksoL16 --constructor-args lsp7arguments.js

# Verify LSP8Mintable contract with constructor arguments
elif [ "${contract}" = "LSP8Mintable" ]
then
    npx hardhat verify $CONTRACT_ADDRESS 'LSP8 Mintable' 'LSP8M' $DEPLOYER_ADDRESS --network luksoL16

# Verify LSP9Vault contract with constructor arguments
elif [ "${contract}" = "LSP9Vault" ]
then
    npx hardhat verify $CONTRACT_ADDRESS $DEPLOYER_ADDRESS --network luksoL16

# Default: verify contract without any constructor arguments (LSP!UniversalReceiverDelegate of UP or Vault)
else
    npx hardhat verify $CONTRACT_ADDRESS --network luksoL16
fi


rm deployment.txt