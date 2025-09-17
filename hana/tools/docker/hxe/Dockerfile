FROM saplabs/hanaexpress:latest

COPY ./start-hdi.sql /usr/sap/HXE/start-hdi.sql
COPY ./setup.sh /setup

# Do initial boot
RUN /setup
