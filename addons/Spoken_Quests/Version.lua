setfenv(1, VoiceOver)
Version = {}

local CLIENT_VERSION, _, _, INTERFACE_VERSION = GetBuildInfo()

Version.Client                  = CLIENT_VERSION
Version.Interface               = INTERFACE_VERSION
