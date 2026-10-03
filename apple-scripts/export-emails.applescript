on run argv
	if (count of argv) ≥ 1 then
		set mailboxName to item 1 of argv
	else
		log "No mailbox name provided"
		return
	end if
	
	if (count of argv) ≥ 2 then
		set exportPath to item 2 of argv
	else
		log "No export path provided"
		return
	end if

	-- Optional: only export messages received at or after this local time (YYYY-MM-DDTHH:MM:SS)
	set receivedSince to missing value
	if (count of argv) ≥ 3 then set receivedSince to my parseISOToDate(item 3 of argv)

	do shell script "mkdir -p " & quoted form of exportPath

	tell application "Mail"
		set targetMailbox to mailbox mailboxName
		if receivedSince is missing value then
			set theMessages to messages of targetMailbox
		else
			-- Mail evaluates the filter itself, so older messages are never walked
			set theMessages to (messages of targetMailbox whose date received ≥ receivedSince)
		end if
		set msgCount to count of theMessages
		
		repeat with i from 1 to msgCount
			set theMessage to item i of theMessages
			set msgSubject to subject of theMessage
			set msgSender to sender of theMessage
			set msgDate to date received of theMessage
			set isoDate to my formatDateToISO(msgDate)
			set msgID to message id of theMessage
			set plainBody to content of theMessage
			set isRead to read status of theMessage
			try
				set htmlBody to source of theMessage
			on error
				set htmlBody to ""
			end try
			
			-- Sanitize subject for filename
			set safeSubject to my sanitizeString(msgSubject)
			set safeMsgID to my sanitizeString(msgID)
			if safeSubject is "" then set safeSubject to "no-subject"
			set baseFilename to "email-" & i & "-" & safeMsgID & safeSubject

			-- File paths
			set dataFilePath to exportPath & "/" & baseFilename & ".txt"
			set htmlFilePath to exportPath & "/" & baseFilename & ".html"
			
			-- Data contents
			set dataText to ""
			set dataText to dataText & "messageId: " & msgID & "\n"
			set dataText to dataText & "sender: " & msgSender & "\n"
			set dataText to dataText & "subject: " & msgSubject & "\n"
			set dataText to dataText & "dateReceived: " & isoDate & "\n"
			set dataText to dataText & "isRead: " & (isRead as string) & "\n"
			set dataText to dataText & "==========================================\n==========================================\n"
			set dataText to dataText & plainBody
			
			-- Write data file
			try
				set dataFile to open for access POSIX file dataFilePath with write permission
				set eof of dataFile to 0
				write dataText to dataFile -- as class utf8
				close access dataFile
			on error errMsg
				try
					close access POSIX file dataFilePath
				end try
				log "Error writing data file: " & errMsg
			end try
			
			-- Write HTML
			if htmlBody is not "" then
				try
					set htmlFile to open for access POSIX file htmlFilePath with write permission
					set eof of htmlFile to 0
					write htmlBody to htmlFile -- as class utf8
					close access htmlFile
				on error errMsg
					try
						close access POSIX file htmlFilePath
					end try
					log "Error writing HTML file: " & errMsg
				end try
			end if
			
			log "Processed email " & i & "/" & msgCount & ": " & dataFilePath
			
		end repeat
	end tell
end run

on formatDateToISO(theDate)
	set y to year of theDate as string
	
	set m to (month of theDate as integer)
	if m < 10 then set m to "0" & m
	set m to m as string
	
	set d to day of theDate as string
	if (count of d) = 1 then set d to "0" & d
	
	set h to hours of theDate as string
	if (count of h) = 1 then set h to "0" & h
	
	set min to minutes of theDate as string
	if (count of min) = 1 then set min to "0" & min
	
	set s to seconds of theDate as string
	if (count of s) = 1 then set s to "0" & s
	
	return y & "-" & m & "-" & d & "T" & h & ":" & min & ":" & s
end formatDateToISO

-- Inverse of formatDateToISO. Built from components because `date "..."` parsing depends on the locale.
on parseISOToDate(isoString)
	set theDate to current date
	-- Day 1 first, so setting the year or month can never overflow into the next month
	set day of theDate to 1
	set year of theDate to (text 1 thru 4 of isoString) as integer
	set month of theDate to (text 6 thru 7 of isoString) as integer
	set day of theDate to (text 9 thru 10 of isoString) as integer
	set time of theDate to ((text 12 thru 13 of isoString) as integer) * hours + ((text 15 thru 16 of isoString) as integer) * minutes + ((text 18 thru 19 of isoString) as integer)
	return theDate
end parseISOToDate

on sanitizeString(inputString)
	set allowedChars to "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
	set sanitizedString to ""
	repeat with i from 1 to (length of inputString)
		set currentChar to character i of inputString
		if allowedChars contains currentChar then
			set sanitizedString to sanitizedString & currentChar
		end if
	end repeat
	return sanitizedString
end sanitizeString
